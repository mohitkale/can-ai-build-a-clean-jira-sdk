// Handwritten client configuration. This module translates developer-facing
// `JiraConfig` into the generated axios client's `setConfig()` — the single
// integration point between the public SDK and the wire. It contains no
// endpoint logic; all operations come from `src/generated/sdk.gen.js`.

import type { AxiosInstance, AxiosStatic } from 'axios';
import { createClient } from './generated/client/index.js';
import type { Auth } from './generated/core/auth.gen.js';
import type { Client, Config } from './generated/client/types.gen.js';

export type { Client as JiraClient };

export type JiraAuth =
  | {
      /** Jira Cloud API token auth (`email` + `apiToken` sent as HTTP Basic). */
      type: 'basic';
      email: string;
      apiToken: string;
    }
  | {
      /**
       * Bearer credential. Accepts a Jira personal access token or an
       * OAuth 2.0 access token — both travel as `Authorization: Bearer …`.
       */
      type: 'bearer';
      token: string;
    };

export interface JiraConfig {
  /** e.g. `https://acme.atlassian.net`. Trailing slashes are trimmed. */
  baseUrl: string;
  /** Omit only for unauthenticated endpoints; Jira returns 401 otherwise. */
  auth?: JiraAuth;
  /** Extra headers merged under per-request headers (requests win). */
  headers?: Record<string, string>;
  /** Axios request timeout in milliseconds. */
  timeout?: number;
  /**
   * Match the generator default (`false`): operations resolve to
   * `{ data, error, … }` instead of throwing. Set `true` to throw.
   * See `src/errors.ts` for the `JiraApiError` bridge covering both shapes.
   */
  throwOnError?: boolean;
  /**
   * Custom axios implementation (e.g. an `axios.create()` instance with
   * proxies or instrumentation). Passed straight to the generated client.
   */
  axios?: AxiosInstance | AxiosStatic;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') {
    throw new Error('JiraConfig.baseUrl must be a non-empty URL.');
  }
  return trimmed;
}

/**
 * Build the per-scheme auth callback the generated client expects.
 *
 * A single static token cannot be used: every operation declares both
 * `basic` and `bearer` security schemes, and a static value would be applied
 * to both, clobbering the `Authorization` header. Returning `undefined` for
 * the unused scheme leaves it unset.
 */
export function resolveAuthCallback(auth: JiraAuth | undefined): Config['auth'] {
  if (auth === undefined) return undefined;
  if (auth.type === 'basic') {
    const credentials = `${auth.email}:${auth.apiToken}`;
    return (scheme: Auth) => (scheme.scheme === 'basic' ? credentials : undefined);
  }
  return (scheme: Auth) => (scheme.scheme === 'bearer' ? auth.token : undefined);
}

export function buildClientConfig(config: JiraConfig): Config {
  return {
    baseURL: normalizeBaseUrl(config.baseUrl),
    auth: resolveAuthCallback(config.auth),
    ...(config.headers !== undefined ? { headers: config.headers } : {}),
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
    ...(config.throwOnError !== undefined ? { throwOnError: config.throwOnError } : {}),
    ...(config.axios !== undefined ? { axios: config.axios } : {}),
  };
}

/**
 * Create an independent, fully-configured API client. Each call returns a new
 * generated `Client` (never the shared singleton) with `baseURL`, auth,
 * headers, timeout, and `throwOnError` applied via `setConfig()`, so the
 * configuration supplied here is exactly what generated operations send.
 */
export function createJiraClient(config: JiraConfig): Client {
  const client = createClient();
  client.setConfig(buildClientConfig(config));
  return client;
}

/**
 * Change auth (or any subset of config) on an existing client. Subsequent
 * generated requests use the new values — credential rotation without
 * rebuilding the client.
 */
export function updateJiraClient(
  client: Client,
  patch: Partial<Pick<JiraConfig, 'auth' | 'headers' | 'timeout' | 'throwOnError'>> & {
    baseUrl?: string;
  },
): void {
  client.setConfig({
    ...(patch.baseUrl !== undefined ? { baseURL: normalizeBaseUrl(patch.baseUrl) } : {}),
    ...(patch.auth !== undefined ? { auth: resolveAuthCallback(patch.auth) } : {}),
    ...(patch.headers !== undefined ? { headers: patch.headers } : {}),
    ...(patch.timeout !== undefined ? { timeout: patch.timeout } : {}),
    ...(patch.throwOnError !== undefined ? { throwOnError: patch.throwOnError } : {}),
  });
}
