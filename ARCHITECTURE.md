# ARCHITECTURE.md — Design Before Implementation

Spec pin: `openapi/jira-cloud-v3.json` (421 paths, 617 operations, upstream
`info.version` 1001.0.0-SNAPSHOT-3d120dbfd2d826e450656947143e5b8779387242,
see `openapi/SOURCE.md`). Generator: `@hey-api/openapi-ts` 0.99.0 with the
axios client. First dry generation confirms 617 exported operations.

## 1. What will be generated

`npm run generate` produces `src/generated/` from the pinned spec, read-only:

- `sdk.gen.ts` — one exported function per OpenAPI `operationId` (617 total),
  plus per-operation `Options`/`Data`/`Responses`/`Errors` types. Functions take
  `(options: { path?, query?, body?, headers?, client?, … })` and return the
  hey-api `RequestResult` (data/error union, or throwing response — see §7).
- `types.gen.ts` — all schema types.
- `client.gen.ts` + `client/` — the axios-backed `Client` (`createClient`,
  `setConfig`, `getConfig`, `instance`, method fns) and the default singleton.
- `core/` — serializers, auth token helpers, SSE plumbing.

No handwritten file may duplicate any of this.

## 2. What will remain handwritten (and why each layer is necessary)

Four small modules, each justified by a gap the generator cannot close on its own:

| File | Job | Why handwritten |
|---|---|---|
| `src/client.ts` | `JiraConfig` / `JiraAuth` types, `createJiraClient()`, `updateJiraClient()` | The generator ships a singleton pinned to the placeholder base URL `https://your-domain.atlassian.net` with no auth. Something must translate developer config (base URL, Basic/Bearer, headers, timeout, `throwOnError`) into `setConfig()` on a real client instance. One module, no endpoint code. |
| `src/pagination.ts` | Generic `paginateOffset` / `paginateToken` async generators + `collect*` | Jira mixes offset pages (`startAt`/`maxResults`/`total`/`isLast`/`values`) and token pages (`nextPageToken`, e.g. `/search/jql`). Generated functions fetch one page; a generic iterator over a caller-supplied fetch callback removes per-endpoint loops without enumerating endpoints. |
| `src/errors.ts` | `JiraApiError`, `throwIfJiraError()`, `isRetryableStatus/Error`, `withRetry()` | The generator returns axios-shaped errors; the SDK needs one documented error type, a bridge from the non-throwing result shape to throwing code, and a retry policy that only retries retryable failures (429/5xx-transient/network) with `Retry-After` support. |
| `src/index.ts` | Public barrel: handwritten modules + `export *` of generated SDK/types | One stable import surface (`jira-cloud-v3-sdk`) so consumers never import `src/generated` paths directly. Contains no logic. |

Explicitly **not** created: `issues`/`projects`/`users` service wrappers — they
would re-list endpoints the generator already exports and add zero ergonomic
value. Target: zero handwritten endpoint-specific functions.

Estimated handwritten production LOC: ~400–500 (client ~150, pagination ~120,
errors ~130, index ~20). Each file stays well under ~300 lines.

## 3. Generated client strategy

Use the generator's native axios client (`@hey-api/client-axios`) as-is.
`createJiraClient()` calls the generated `createClient()` to obtain an
independent `Client` (never the shared singleton, so multiple SDK instances
coexist), then applies `setConfig()`. Every generated operation accepts
`{ client }` per call, so wiring is explicit and testable. If the generator's
abstraction solves something (serialization, URL building), it is used — never
duplicated.

## 4. Authentication strategy

The spec declares `basicAuth` (http basic) and `OAuth2` (bearer); every
operation lists `security: [{ scheme: 'basic' }, { scheme: 'bearer' }]`. The
generated client resolves credentials per request via `Config.auth`, which may
be a per-scheme callback — required because a single static token would be
applied to *both* schemes and one would clobber the `Authorization` header.

- Basic: `auth: (scheme) => scheme.scheme === 'basic' ? \`${email}:${apiToken}\` : undefined`
  (the client base64-encodes it into `Basic …`).
- Bearer/OAuth 2.0 access token: `auth: (scheme) => scheme.scheme === 'bearer' ? token : undefined`
  producing `Bearer …`. OAuth and personal-access Bearer tokens share this path
  (both are bearer credentials on the wire); the distinction is documented, not
  branched.
- No auth configured → no header (lets public endpoints work; Jira returns 401
  otherwise, surfaced as `JiraApiError` with status 401).

`updateJiraClient(client, { auth })` re-runs `setConfig()`, so credential
rotation affects subsequent requests — verified by integration test, not by
storing config in a disconnected wrapper.

## 5. Base URL configuration

`JiraConfig.baseUrl` (e.g. `https://acme.atlassian.net`) is normalized
(trailing slashes trimmed; empty rejected) and passed as axios `baseURL`.
Generated paths already contain the `/rest/api/3` prefix, so no path joining
is needed. Changing it via `updateJiraClient()` changes subsequent requests;
tests assert the outgoing host.

## 6. Public SDK ergonomics

```ts
import { createJiraClient, getIssue } from 'jira-cloud-v3-sdk';

const client = createJiraClient({
  baseUrl: 'https://acme.atlassian.net',
  auth: { type: 'basic', email, apiToken },
});
const issue = await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } });
```

Generated operation names are used verbatim (`getIssue`, `createIssue`,
`searchForIssuesUsingJql`, …). No invented aliases. Per-call `{ client }`
override plus global client config covers all cases.

## 7. Error semantics

Match the generator default: `throwOnError: false` → operations resolve to
`{ data, error, response, … }`; failures carry axios `response.status` and the
server's error payload in `error`. Rationale: changing the default would fight
the generated types (`RequestResult` branches on `ThrowOnError`). Users opting
into `throwOnError: true` get thrown axios errors. Both shapes funnel into
`JiraApiError` (`status`, `message`, `errorBody`, `retryAfterMs`) via
`throwIfJiraError()` (for the returning shape) and `toJiraApiError()` (for the
thrown shape). Retry (`withRetry`) only retries 429 / 502 / 503 / 504 and
network failures — never 400 / 401 / 403 / 404 / 500 — honoring `Retry-After`.

## 8. Pagination strategy

No single response shape assumed. Two generic helpers over caller-supplied
fetch callbacks, preserving generated types end-to-end via generics:

- `paginateOffset(fetchPage)` for `values` + `startAt`/`isLast`/`total` pages.
  Continue while `isLast === false`, else while `startAt + values.length < total`
  (with explicit `undefined` checks — never truthiness, so `total: 0` and
  `startAt: 0` behave). Stop on empty `values` as a safety net.
- `paginateToken(fetchPage)` for `nextPageToken` pages (enhanced search).
  Stop when the token is absent.

Boundaries tested: `startAt = 0`, multi-page, final page, zero results, single
page, missing `total`/`isLast`.

## 9. Testing strategy

- Unit (`tests/unit/`): pure logic only — URL normalization, per-scheme auth
  callback selection, retry classification/delays, paginator stepping with fake
  fetch callbacks.
- Integration (`tests/integration/`, axios-mock-adapter on the **real**
  `client.instance` — the network boundary, never a stubbed SDK): hostname
  used, Basic header, Bearer header, auth/base-URL switching, a real generated
  operation serializing path/query/body, pagination boundaries through a real
  generated paged operation, all error statuses + network failure + retry.
- Docs-as-code: `examples/*.ts` type-checked (`tsconfig.examples.json`); every
  README snippet mirrors a checked example using real export/operation names.

## 10. Regeneration strategy

Pin → generate → verify: `openapi/jira-cloud-v3.json` + `openapi/SOURCE.md`
(source URL, fetch date, upstream version, SHA-256, counts) → `npm run
generate` (works from a clean clone; local input path) → `npm run coverage`
must report zero missing operations. Refresh via `npm run download-spec`.

## 11. npm packaging strategy

`tsup` builds ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + declarations
(`dist/index.d.ts`) from `src/index.ts`; `package.json` `exports` maps both
with types. No CJS claim without a CJS artifact — verified with `npm pack`.
`files` includes `dist`, `openapi` (reproducibility), and root docs. Engines:
node ≥ 18 (global `btoa`/fetch used by generated auth/download script).

## 12. How complete API coverage will be objectively verified

`scripts/coverage.mjs` parses all 617 spec `operationId`s and all `export
const|function` names in `src/generated/sdk.gen.ts`; `npm run coverage`
prints totals + missing list and exits non-zero on any gap. Final report must
show total OpenAPI operations / generated / exported / missing (expected:
617 / 617 / 617 / none). No coverage claim without this output.
