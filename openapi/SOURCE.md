# OpenAPI Source of Truth

This directory pins the exact specification used to generate this SDK.

- Source URL: https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
- Local file: `openapi/jira-cloud-v3.json`
- Fetched at (UTC): 2026-09-12T18:28:04Z
- Upstream `info.version`: 1001.0.0-SNAPSHOT-3d120dbfd2d826e450656947143e5b8779387242
- SHA-256 of downloaded document: `44a651e69946782fcb943bab316bee98f5d831fb69aa9b3b0d566dade3b66ba8`
- Paths: 421
- Operations: 617

## Reproduce

From a clean clone, no manual lookup is needed:

```sh
npm install
npm run generate
```

`openapi-ts.config.ts` reads `./openapi/jira-cloud-v3.json` (the pinned file).
Run `npm run download-spec` to refresh the pin; this rewrites both the JSON
and this file. Regeneration output goes to `src/generated/` and must never be
hand-edited (see AGENTS.md).
