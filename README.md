# jira-cloud-v3-sdk

TypeScript SDK for the **Jira Cloud REST API v3**, generated from Atlassian's
official OpenAPI specification with
[`@hey-api/openapi-ts`](https://heyapi.dev). Every endpoint, request type, and
response type comes from the pinned spec — nothing is hand-copied.

- **Complete coverage:** all 617 OpenAPI operations exported (verified by
  `npm run coverage`).
- **Small handwritten surface:** client configuration, generic pagination
  iterators, and a unified error/retry layer. No hand-written endpoint
  wrappers.
- **Strongly typed end-to-end:** generated types flow from request to response.

> Every snippet below mirrors a type-checked file in `examples/` (checked by
> `npm run typecheck:examples`). Operation names are the generator's verbatim
> exports (`getIssue`, `createIssue`, …).

## Install

```sh
npm install jira-cloud-v3-sdk
```

Requires Node 18+.

## Quickstart

```ts
import { createJiraClient, getIssue, throwIfJiraError } from 'jira-cloud-v3-sdk';

const client = createJiraClient({
  baseUrl: 'https://acme.atlassian.net',
  auth: { type: 'basic', email: process.env['JIRA_EMAIL']!, apiToken: process.env['JIRA_API_TOKEN']! },
});

const issue = await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } }).then(throwIfJiraError);
console.log(issue.key, issue.fields?.summary);
```

## Authentication

Pass credentials once; the SDK wires them into the generated axios client via
`setConfig()`, so every generated operation sends them. A per-scheme callback
ensures Basic credentials never leak into the Bearer header and vice versa.

```ts
// API token (Basic)
createJiraClient({
  baseUrl,
  auth: { type: 'basic', email, apiToken },
});

// Personal access token or OAuth 2.0 access token (Bearer)
createJiraClient({
  baseUrl,
  auth: { type: 'bearer', token },
});
```

Rotate credentials or retarget an instance without rebuilding it:

```ts
import { updateJiraClient } from 'jira-cloud-v3-sdk';

updateJiraClient(client, { auth: { type: 'bearer', token: rotated } });
updateJiraClient(client, { baseUrl: 'https://other.atlassian.net' });
```

Extra headers, timeouts, and a custom axios instance pass straight through to
the generated client:

```ts
createJiraClient({ baseUrl, auth, headers: { 'X-Custom': 'yes' }, timeout: 10_000 });
```

## Calling the API

Use the generated operations directly — all 617 are re-exported from the
package root. Each takes `{ client, path?, query?, body?, headers? }`:

```ts
import { createIssue, searchForIssuesUsingJql } from 'jira-cloud-v3-sdk';

const page = await searchForIssuesUsingJql({
  client,
  query: { jql: 'assignee = currentUser() order by key', maxResults: 25 },
}).then(throwIfJiraError);
```

## Pagination

Jira mixes offset pages (`values` + `startAt`/`total`/`isLast`) and token
pages (`nextPageToken`). The generic iterators walk either shape over a
caller-supplied fetch callback — no per-endpoint loops:

```ts
import { collectOffset } from 'jira-cloud-v3-sdk';
import { searchProjects } from 'jira-cloud-v3-sdk';

const projects = await collectOffset(
  async ({ startAt, maxResults }) =>
    searchProjects({ client, query: { startAt, maxResults } }).then(throwIfJiraError),
  { maxResults: 50 },
);
```

Pages that name their items differently (comment search returns
`PageOfComments.comments`) are adapted at the call site:

```ts
import { getComments } from 'jira-cloud-v3-sdk';

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
  { maxResults: 50 },
);
```

## Errors and retries

The SDK keeps the generator default (`throwOnError: false`): operations
resolve to `{ data, error, … }`. `throwIfJiraError()` converts failures to a
single `JiraApiError` (with `status`, server payload, and `retryAfterMs`);
`withRetry()` retries only 429 / 502 / 503 / 504 and network failures —
never 400 / 401 / 403 / 404 / 500 — honoring `Retry-After`:

```ts
import { JiraApiError, throwIfJiraError, withRetry } from 'jira-cloud-v3-sdk';

const created = await withRetry(() =>
  createIssue({
    client,
    body: { fields: { project: { key: 'PROJ' }, summary: 'Hello', issuetype: { name: 'Task' } } },
  }).then(throwIfJiraError),
).catch((error: unknown) => {
  if (error instanceof JiraApiError) console.error(error.status, error.message);
  throw error;
});
```

Set `throwOnError: true` in `createJiraClient()` to throw axios errors
instead, and normalize them with `toJiraApiError()`.

## Regeneration

The spec is pinned at `openapi/jira-cloud-v3.json` (source, date, version,
and SHA-256 in `openapi/SOURCE.md`). From a clean clone:

```sh
npm install
npm run generate   # regenerate src/generated/ (never hand-edit)
npm run coverage   # prove 617/617 operations exported
```

Refresh the pin with `npm run download-spec`.

## Verification

```sh
npm run coverage && npm run typecheck && npm run typecheck:examples \
  && npm run lint && npm test && npm run build && npm pack --dry-run
```

See `ARCHITECTURE.md` (design), `AGENTS.md` (engineering contract), and
`QUALITY_REPORT.md` (audit + adversarial review).

## License

MIT.
