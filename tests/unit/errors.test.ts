import { describe, expect, it } from 'vitest';

import {
  isRetryableError,
  isRetryableStatus,
  JiraApiError,
  parseRetryAfter,
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
