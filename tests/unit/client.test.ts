import { describe, expect, it } from 'vitest';

import {
  buildClientConfig,
  createJiraClient,
  normalizeBaseUrl,
  resolveAuthCallback,
} from '../../src/client.js';
import type { Auth } from '../../src/generated/core/auth.gen.js';

const basic: Auth = { scheme: 'basic', type: 'http' };
const bearer: Auth = { scheme: 'bearer', type: 'http' };

describe('normalizeBaseUrl', () => {
  it('trims trailing slashes', () => {
    expect(normalizeBaseUrl('https://acme.atlassian.net///')).toBe('https://acme.atlassian.net');
  });

  it('rejects empty values', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow(/baseUrl/);
  });
});

describe('resolveAuthCallback', () => {
  it('returns undefined when no auth is configured', () => {
    expect(resolveAuthCallback(undefined)).toBeUndefined();
  });

  it('supplies Basic credentials only for the basic scheme', async () => {
    const auth = resolveAuthCallback({ type: 'basic', email: 'a@x.com', apiToken: 'tok' });
    expect(typeof auth).toBe('function');
    if (typeof auth !== 'function') throw new Error('unreachable');
    expect(await auth(basic)).toBe('a@x.com:tok');
    expect(await auth(bearer)).toBeUndefined();
  });

  it('supplies the Bearer token only for the bearer scheme', async () => {
    const auth = resolveAuthCallback({ type: 'bearer', token: 'oauth-token' });
    if (typeof auth !== 'function') throw new Error('unreachable');
    expect(await auth(bearer)).toBe('oauth-token');
    expect(await auth(basic)).toBeUndefined();
  });
});

describe('buildClientConfig', () => {
  it('maps timeout, headers, and throwOnError through', () => {
    const config = buildClientConfig({
      baseUrl: 'https://acme.atlassian.net/',
      auth: { type: 'bearer', token: 't' },
      headers: { 'X-Custom': 'yes' },
      timeout: 5000,
      throwOnError: true,
    });
    expect(config.baseURL).toBe('https://acme.atlassian.net');
    expect(config.timeout).toBe(5000);
    expect(config.throwOnError).toBe(true);
  });
});

describe('createJiraClient', () => {
  it('applies baseURL to the generated client config', () => {
    const client = createJiraClient({
      baseUrl: 'https://acme.atlassian.net',
      auth: { type: 'basic', email: 'a@x.com', apiToken: 'tok' },
    });
    expect(client.getConfig().baseURL).toBe('https://acme.atlassian.net');
  });

  it('creates independent instances', () => {
    const first = createJiraClient({ baseUrl: 'https://a.atlassian.net' });
    const second = createJiraClient({ baseUrl: 'https://b.atlassian.net' });
    expect(first.getConfig().baseURL).toBe('https://a.atlassian.net');
    expect(second.getConfig().baseURL).toBe('https://b.atlassian.net');
  });
});
