// Serialization through a real generated operation: path params, query
// params, and JSON bodies must arrive at the HTTP boundary intact.

import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { createJiraClient } from '../../src/client.js';
import { createIssue, getIssue } from '../../src/generated/sdk.gen.js';
import { createTestTransport } from '../helpers/test-transport.js';
import type { MockResponder, TestTransport } from '../helpers/test-transport.js';

const BASE_URL = 'https://acme.atlassian.net';

function testClient(responder: MockResponder): {
  client: ReturnType<typeof createJiraClient>;
  transport: TestTransport;
} {
  const transport = createTestTransport(responder);
  const client = createJiraClient({
    baseUrl: BASE_URL,
    auth: { type: 'basic', email: 'dev@acme.com', apiToken: 'tok' },
    axios: axios.create({ adapter: transport.adapter }),
  });
  return { client, transport };
}

describe('parameter serialization', () => {
  it('serializes path parameters into the URL', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }));
    await getIssue({ client, path: { issueIdOrKey: 'PROJ-42' } });

    expect(transport.requests[0]?.url).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-42`);
  });

  it('serializes query parameters into the URL', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }));
    await getIssue({
      client,
      path: { issueIdOrKey: 'PROJ-42' },
      query: { expand: 'changelog', fieldsByKeys: true },
    });

    const url = transport.requests[0]?.url ?? '';
    expect(url).toContain('/rest/api/3/issue/PROJ-42?');
    expect(url).toContain('expand=changelog');
    expect(url).toContain('fieldsByKeys=true');
  });

  it('serializes array query parameters', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }));
    await getIssue({
      client,
      path: { issueIdOrKey: 'PROJ-42' },
      query: { fields: ['summary', 'status'] },
    });

    const url = transport.requests[0]?.url ?? '';
    expect(url).toContain('fields=');
    expect(url).toContain('summary');
    expect(url).toContain('status');
  });

  it('serializes JSON request bodies', async () => {
    const { client, transport } = testClient((request) => {
      expect(request.method).toBe('post');
      return { status: 201, body: { key: 'PROJ-7' } };
    });

    const body = {
      fields: {
        project: { key: 'PROJ' },
        summary: 'Typed body round-trip',
        issuetype: { name: 'Task' },
      },
    };
    const result = await createIssue({ client, body });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe(`${BASE_URL}/rest/api/3/issue`);
    expect(JSON.parse(String(transport.requests[0]?.data))).toEqual(body);
    expect(result.data).toMatchObject({ key: 'PROJ-7' });
  });
});
