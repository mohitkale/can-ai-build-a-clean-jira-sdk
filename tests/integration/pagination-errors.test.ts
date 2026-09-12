// Pagination boundaries through a real generated paged operation
// (`getComments` → `PageOfComments`), plus error/retry behavior at the HTTP
// boundary for 400/401/403/404/429/500 and network failure.

import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { createJiraClient } from '../../src/client.js';
import { JiraApiError, throwIfJiraError, toJiraApiError, withRetry } from '../../src/errors.js';
import { collectOffset, collectToken } from '../../src/pagination.js';
import {
  getComments,
  getIssue,
  searchAndReconsileIssuesUsingJql,
  searchProjects,
} from '../../src/generated/sdk.gen.js';
import { createTestTransport } from '../helpers/test-transport.js';
import type { MockResponder, TestTransport } from '../helpers/test-transport.js';

const BASE_URL = 'https://acme.atlassian.net';

function testClient(
  responder: MockResponder,
  throwOnError = false,
): { client: ReturnType<typeof createJiraClient>; transport: TestTransport } {
  const transport = createTestTransport(responder);
  const client = createJiraClient({
    baseUrl: BASE_URL,
    auth: { type: 'basic', email: 'dev@acme.com', apiToken: 'tok' },
    axios: axios.create({ adapter: transport.adapter }),
    throwOnError,
  });
  return { client, transport };
}

describe('offset pagination over searchProjects', () => {
  it('collects multiple pages starting at startAt = 0', async () => {
    const { client, transport } = testClient((request) => {
      if (request.url.includes('startAt=2')) {
        return {
          status: 200,
          body: { values: [{ key: 'C' }], startAt: 2, maxResults: 2, total: 3, isLast: true },
        };
      }
      return {
        status: 200,
        body: {
          values: [{ key: 'A' }, { key: 'B' }],
          startAt: 0,
          maxResults: 2,
          total: 3,
          isLast: false,
        },
      };
    });

    const projects = await collectOffset(
      async ({ startAt, maxResults }) =>
        searchProjects({ client, query: { startAt, maxResults } }).then(throwIfJiraError),
      { maxResults: 2 },
    );

    expect(projects.map((project) => project.key)).toEqual(['A', 'B', 'C']);
    expect(transport.requests).toHaveLength(2);
    // startAt = 0 (not a truthy placeholder) opens the sequence.
    expect(transport.requests[0]?.url).toContain('startAt=0');
    expect(transport.requests[1]?.url).toContain('startAt=2');
  });

  it('returns an empty array for zero results', async () => {
    const { client, transport } = testClient(() => ({
      status: 200,
      body: { values: [], startAt: 0, maxResults: 50, total: 0, isLast: true },
    }));

    const projects = await collectOffset(async ({ startAt, maxResults }) =>
      searchProjects({ client, query: { startAt, maxResults } }).then(throwIfJiraError),
    );

    expect(projects).toEqual([]);
    expect(transport.requests).toHaveLength(1);
  });
});

describe('offset pagination over non-values pages (getComments)', () => {
  it('adapts PageOfComments.comments at the call site', async () => {
    const { client, transport } = testClient((request) => {
      if (request.url.includes('startAt=1')) {
        return { status: 200, body: { comments: [{ id: '2' }], startAt: 1, maxResults: 1, total: 2 } };
      }
      return {
        status: 200,
        body: { comments: [{ id: '1' }], startAt: 0, maxResults: 1, total: 2 },
      };
    });

    const comments = await collectOffset(
      async ({ startAt, maxResults }) => {
        const page = await getComments({
          client,
          path: { issueIdOrKey: 'PROJ-1' },
          query: { startAt, maxResults },
        }).then(throwIfJiraError);
        const values = page.comments ?? [];
        const origin = page.startAt ?? startAt;
        return {
          values,
          startAt: origin,
          maxResults: page.maxResults,
          total: page.total,
          isLast: page.total === undefined ? undefined : origin + values.length >= page.total,
        };
      },
      { maxResults: 1 },
    );

    expect(comments.map((comment) => comment.id)).toEqual(['1', '2']);
    expect(transport.requests).toHaveLength(2);
  });
});

describe('token pagination over enhanced search', () => {
  it('follows nextPageToken and stops on the documented null last page', async () => {
    const { client, transport } = testClient((request) => {
      if (request.url.includes('nextPageToken=t1')) {
        return { status: 200, body: { issues: [{ key: 'B' }], nextPageToken: null } };
      }
      return { status: 200, body: { issues: [{ key: 'A' }], nextPageToken: 't1' } };
    });

    const issues = await collectToken(async (token) =>
      searchAndReconsileIssuesUsingJql({
        client,
        query: {
          jql: 'assignee = currentUser() order by key',
          ...(token === undefined ? {} : { nextPageToken: token }),
        },
      })
        .then(throwIfJiraError)
        .then((page) => ({ values: page.issues, nextPageToken: page.nextPageToken })),
    );

    expect(issues.map((issue) => issue.key)).toEqual(['A', 'B']);
    expect(transport.requests).toHaveLength(2);
  });
});

describe('error behavior at the boundary', () => {
  it.each([
    [400, { errorMessages: ['Bad request.'] }],
    [401, { errorMessages: ['Unauthorized.'] }],
    [403, { errorMessages: ['Forbidden.'] }],
    [404, { errorMessages: ['Issue does not exist.'] }],
    [429, { errorMessages: ['Rate limited.'] }],
    [500, { errorMessages: ['Server error.'] }],
  ])('surfaces HTTP %i as JiraApiError with status', async (status, payload) => {
    const { client } = testClient(() => ({ status, body: payload }));

    const result = await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });
    let caught: unknown;
    try {
      throwIfJiraError(result);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JiraApiError);
    expect((caught as JiraApiError).status).toBe(status);
  });

  it('surfaces a network failure as a retryable JiraApiError without status', async () => {
    const { client } = testClient(() => ({ status: 0, body: undefined, networkError: true }));

    const result = await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });
    let caught: unknown;
    try {
      throwIfJiraError(result);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JiraApiError);
    expect((caught as JiraApiError).status).toBeUndefined();
  });

  it('throwOnError clients raise errors that normalize to JiraApiError', async () => {
    const { client } = testClient(() => ({ status: 404, body: { errorMessages: ['missing'] } }), true);

    const error = await getIssue({ client, path: { issueIdOrKey: 'NOPE' } }).catch(
      (error: unknown) => error,
    );
    expect(toJiraApiError(error).status).toBe(404);
  });

  it('withRetry recovers when a 429 is followed by success', async () => {
    const { client, transport } = testClient((_request, index) =>
      index === 0
        ? { status: 429, body: { errorMessages: ['slow down'] } }
        : { status: 200, body: { key: 'PROJ-1' } },
    );

    const issue = await withRetry(
      () => getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } }).then(throwIfJiraError),
      { sleep: async () => undefined },
    );
    expect(issue).toMatchObject({ key: 'PROJ-1' });
    expect(transport.requests).toHaveLength(2);
  });

  it('withRetry does not retry a 404', async () => {
    const { client, transport } = testClient(() => ({
      status: 404,
      body: { errorMessages: ['missing'] },
    }));

    await expect(
      withRetry(
        () => getIssue({ client, path: { issueIdOrKey: 'NOPE' } }).then(throwIfJiraError),
        { sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(transport.requests).toHaveLength(1);
  });

  it('withRetry honors the Retry-After response header on 429', async () => {
    const delays: number[] = [];
    const { client, transport } = testClient((_request, index) =>
      index === 0
        ? { status: 429, body: { errorMessages: ['slow down'] }, headers: { 'retry-after': '4' } }
        : { status: 200, body: { key: 'PROJ-1' } },
    );

    const issue = await withRetry(
      () => getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } }).then(throwIfJiraError),
      { sleep: async (ms) => void delays.push(ms) },
    );
    expect(issue).toMatchObject({ key: 'PROJ-1' });
    expect(delays).toEqual([4000]);
    expect(transport.requests).toHaveLength(2);
  });
});
