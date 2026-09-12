// End-to-end wiring: developer configuration → public SDK → generated
// client → axios → HTTP request. The transport boundary (a per-test axios
// adapter) is mocked; the generated client itself is never stubbed.

import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { createJiraClient, updateJiraClient } from '../../src/client.js';
import type { JiraConfig } from '../../src/client.js';
import { getIssue } from '../../src/generated/sdk.gen.js';
import { createTestTransport, staticTransport } from '../helpers/test-transport.js';
import type { MockResponder, TestTransport } from '../helpers/test-transport.js';

const BASE_URL = 'https://acme.atlassian.net';

function testClient(
  responder: MockResponder,
  config: Partial<JiraConfig> = {},
): { client: ReturnType<typeof createJiraClient>; transport: TestTransport } {
  const transport = createTestTransport(responder);
  const client = createJiraClient({
    baseUrl: BASE_URL,
    auth: { type: 'basic', email: 'dev@acme.com', apiToken: 'api-token-123' },
    axios: axios.create({ adapter: transport.adapter }),
    ...config,
  });
  return { client, transport };
}

describe('base URL wiring', () => {
  it('sends generated requests to the configured hostname', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: { key: 'PROJ-1' } }));

    const result = await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-1`);
    expect(result.data).toMatchObject({ key: 'PROJ-1' });
  });

  it('changing the base URL changes subsequent requests', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }));
    await getIssue({ client, path: { issueIdOrKey: 'A-1' } });

    updateJiraClient(client, { baseUrl: 'https://other.atlassian.net' });
    await getIssue({ client, path: { issueIdOrKey: 'A-1' } });

    expect(transport.requests.map((r) => r.url)).toEqual([
      `${BASE_URL}/rest/api/3/issue/A-1`,
      'https://other.atlassian.net/rest/api/3/issue/A-1',
    ]);
  });
});

describe('authentication wiring', () => {
  it('applies Basic auth from email + API token', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }));
    await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });

    const expected = `Basic ${Buffer.from('dev@acme.com:api-token-123').toString('base64')}`;
    expect(transport.requests[0]?.headers['Authorization']).toBe(expected);
  });

  it('applies a Bearer token', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }), {
      auth: { type: 'bearer', token: 'oauth-access-token' },
    });
    await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });

    expect(transport.requests[0]?.headers['Authorization']).toBe('Bearer oauth-access-token');
  });

  it('changing auth changes subsequent requests', async () => {
    const { client, transport } = testClient(() => ({ status: 200, body: {} }));
    await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });

    updateJiraClient(client, { auth: { type: 'bearer', token: 'rotated-token' } });
    await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });

    const headers = transport.requests.map((r) => r.headers['Authorization']);
    expect(headers[0]).toMatch(/^Basic /);
    expect(headers[1]).toBe('Bearer rotated-token');
  });

  it('generated operations use the client passed per call', async () => {
    const first = testClient(() => ({ status: 200, body: { key: 'ONE' } }), {
      baseUrl: 'https://one.atlassian.net',
      auth: undefined,
    });
    const second = testClient(() => ({ status: 200, body: { key: 'TWO' } }), {
      baseUrl: 'https://two.atlassian.net',
      auth: undefined,
    });

    const [a, b] = await Promise.all([
      getIssue({ client: first.client, path: { issueIdOrKey: 'X-1' } }),
      getIssue({ client: second.client, path: { issueIdOrKey: 'X-1' } }),
    ]);

    expect(a.data).toMatchObject({ key: 'ONE' });
    expect(b.data).toMatchObject({ key: 'TWO' });
    expect(first.transport.requests[0]?.url).toContain('https://one.atlassian.net');
    expect(second.transport.requests[0]?.url).toContain('https://two.atlassian.net');
  });

  it('sends no Authorization header when auth is omitted', async () => {
    const transport = staticTransport(200, {});
    const client = createJiraClient({
      baseUrl: BASE_URL,
      axios: axios.create({ adapter: transport.adapter }),
    });
    await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });

    expect(transport.requests[0]?.headers['Authorization']).toBeUndefined();
  });
});
