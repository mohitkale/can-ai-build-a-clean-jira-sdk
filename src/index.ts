// Public SDK surface: handwritten modules plus the full generated API.
// Generated operation names are re-exported verbatim (`getIssue`, …) —
// no invented aliases. Consumers must never import `src/generated` directly.

export {
  buildClientConfig,
  createJiraClient,
  normalizeBaseUrl,
  resolveAuthCallback,
  updateJiraClient,
} from './client.js';
export type { JiraAuth, JiraClient, JiraConfig } from './client.js';
export {
  isRetryableError,
  isRetryableStatus,
  JiraApiError,
  parseRetryAfter,
  REDACTED_CREDENTIAL,
  RETRYABLE_STATUS_CODES,
  sanitizeErrorCause,
  throwIfJiraError,
  toJiraApiError,
  withRetry,
} from './errors.js';
export type { JiraApiErrorDetails, JiraResult, RetryOptions } from './errors.js';
export { collectOffset, collectToken, paginateOffset, paginateToken } from './pagination.js';
export type { OffsetPage, PaginateOptions, TokenPage } from './pagination.js';

export * from './generated/sdk.gen.js';
export type * from './generated/types.gen.js';
