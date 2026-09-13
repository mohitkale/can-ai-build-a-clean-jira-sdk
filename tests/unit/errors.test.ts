import { describe, expect, it } from 'vitest';
import { AxiosHeaders } from 'axios';

import {
  isRetryableError,
  isRetryableStatus,
  JiraApiError,
  parseRetryAfter,
  REDACTED_CREDENTIAL,
  sanitizeErrorCause,
  throwIfJiraError,
  toJiraApiError,
  withRetry,
} from '../../src/errors.js';

describe('isRetryableStatus', () => {
  it.each([429, 502, 503, 504])('retries %i', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 500, undefined])('does not retry %s', (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });
});

describe('toJiraApiError', () => {
  it('extracts status and server messages from a thrown axios error', () => {
    const axiosError = {
      response: { status: 404, data: { errorMessages: ['Issue does not exist.'] }, headers: {} },
      message: 'Request failed with status code 404',
    };
    const error = toJiraApiError(axiosError);
    expect(error).toBeInstanceOf(JiraApiError);
    expect(error.status).toBe(404);
    expect(error.message).toContain('Issue does not exist.');
    expect(isRetryableError(error)).toBe(false);
  });

  it('treats a network failure (no response) as retryable with undefined status', () => {
    const error = toJiraApiError({ request: {}, message: 'Network Error' });
    expect(error.status).toBeUndefined();
    expect(isRetryableError(error)).toBe(true);
  });

  it('passes JiraApiError through unchanged', () => {
    const original = new JiraApiError({ status: 429, message: 'slow down' });
    expect(toJiraApiError(original)).toBe(original);
  });
});

describe('throwIfJiraError', () => {
  it('returns data when error is absent', () => {
    expect(throwIfJiraError({ data: { id: '1' }, error: undefined })).toEqual({ id: '1' });
  });

  it('throws JiraApiError carrying status and payload', () => {
    const result = {
      data: undefined,
      error: { errorMessages: ['Unauthorized.'] },
      response: { status: 401 },
    };
    let caught: unknown;
    try {
      throwIfJiraError(result);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JiraApiError);
    expect((caught as JiraApiError).status).toBe(401);
  });
});

describe('sanitizeErrorCause', () => {
  it('redacts credential headers without mutating the original error', () => {
    class FakeAxiosError extends Error {
      config: { headers: Record<string, string> };
      constructor() {
        super('Request failed with status code 401');
        this.config = { headers: { Authorization: 'Basic QUJD', Accept: 'application/json' } };
      }
    }
    const original = new FakeAxiosError();
    const sanitized = sanitizeErrorCause(original) as FakeAxiosError;

    expect(sanitized).not.toBe(original);
    expect(sanitized).toBeInstanceOf(FakeAxiosError);
    expect(sanitized.config.headers['Authorization']).toBe(REDACTED_CREDENTIAL);
    expect(sanitized.config.headers['Accept']).toBe('application/json');
    expect(original.config.headers['Authorization']).toBe('Basic QUJD');
  });

  it('redacts real AxiosHeaders instances while keeping status parsing intact', () => {
    const headers = new AxiosHeaders({ authorization: 'Bearer secret', 'Content-Type': 'application/json' });
    const error = {
      config: { headers },
      message: 'Request failed with status code 401',
      response: { status: 401, data: { errorMessages: ['Unauthorized.'] }, headers: {} },
    };
    const normalized = toJiraApiError(error);
    const cause = normalized.cause as { config: { headers: unknown } };
    const stored = cause.config.headers as unknown as Record<string, unknown>;

    expect(stored['authorization']).toBe(REDACTED_CREDENTIAL);
    expect(stored['Content-Type']).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(normalized.status).toBe(401);
    expect(normalized.message).toContain('Unauthorized.');
  });

  it('redacts credentials nested under response.config sharing one instance', () => {
    const shared = { headers: { Authorization: 'Basic QUJD' } };
    const error = {
      config: shared,
      message: 'Request failed with status code 401',
      response: { status: 401, data: {}, headers: {}, config: shared },
    };
    const out = sanitizeErrorCause(error) as typeof error;

    expect(out).not.toBe(error);
    const top = out.config.headers as unknown as Record<string, unknown>;
    const nested = (out.response.config as { headers: unknown }).headers as unknown as Record<
      string,
      unknown
    >;
    expect(top['Authorization']).toBe(REDACTED_CREDENTIAL);
    expect(nested['Authorization']).toBe(REDACTED_CREDENTIAL);
    expect((shared.headers as Record<string, unknown>)['Authorization']).toBe('Basic QUJD');
  });

  it('passes errors without a request config through unchanged', () => {
    const plain = new Error('boom');
    expect(sanitizeErrorCause(plain)).toBe(plain);
    expect(sanitizeErrorCause('nope')).toBe('nope');
    const noAuth = { config: { headers: { Accept: 'application/json' } } };
    expect(sanitizeErrorCause(noAuth)).toBe(noAuth);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and returns undefined when absent', () => {
    expect(parseRetryAfter({ 'retry-after': '2' })).toBe(2000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter({})).toBeUndefined();
  });

  it('reads AxiosHeaders-style getters case-insensitively', () => {
    const headers = {
      get: (name: string) => (name === 'retry-after' ? '3' : undefined),
    } as unknown as Record<string, unknown>;
    expect(parseRetryAfter(headers)).toBe(3000);
  });
});

describe('withRetry', () => {
  it('retries a 429 then succeeds, honoring Retry-After', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new JiraApiError({ status: 429, message: 'rate limited', retryAfterMs: 5 });
        }
        return 'ok';
      },
      { maxAttempts: 3, sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(delays).toEqual([5, 5]);
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new JiraApiError({ status: 404, message: 'missing' });
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toBeInstanceOf(JiraApiError);
    expect(calls).toBe(1);
  });

  it('gives up after maxAttempts on persistent 503s', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new JiraApiError({ status: 503, message: 'down' });
        },
        { maxAttempts: 2, baseDelayMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(2);
  });
});
