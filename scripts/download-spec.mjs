// Pins and refreshes the exact OpenAPI specification used for code generation.
//
// Source of truth:
//   https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
//
// Usage:
//   node scripts/download-spec.mjs            # download + refresh SOURCE.md metadata
//   node scripts/download-spec.mjs --check-only  # verify pinned file exists (used by `npm run generate`)
//
// `npm run generate` must work from a clean clone without manually locating
// the OpenAPI file: the pinned file lives at openapi/jira-cloud-v3.json and
// openapi-ts.config.ts points at that local path.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_URL = 'https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(rootDir, 'openapi', 'jira-cloud-v3.json');
const sourcePath = join(rootDir, 'openapi', 'SOURCE.md');

function countOperations(spec) {
  let total = 0;
  const methods = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
  for (const item of Object.values(spec.paths ?? {})) {
    for (const method of methods) {
      if (item?.[method]) total += 1;
    }
  }
  return total;
}

async function main() {
  const checkOnly = process.argv.includes('--check-only');
  if (checkOnly) {
    if (!existsSync(specPath)) {
      console.error(`Pinned spec missing: ${specPath}. Run \`npm run download-spec\`.`);
      process.exit(1);
    }
    return;
  }

  const response = await fetch(SPEC_URL);
  if (!response.ok) {
    throw new Error(`Failed to download spec: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const spec = JSON.parse(text);

  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);

  const sha256 = createHash('sha256').update(text).digest('hex');
  const fetchedAt = new Date().toISOString();
  const operations = countOperations(spec);
  const paths = Object.keys(spec.paths ?? {}).length;
  const apiVersion = spec?.info?.version ?? 'unknown';

  const sourceMd = `# OpenAPI Source of Truth

This directory pins the exact specification used to generate this SDK.

- Source URL: ${SPEC_URL}
- Local file: \`openapi/jira-cloud-v3.json\`
- Fetched at (UTC): ${fetchedAt}
- Upstream \`info.version\`: ${apiVersion}
- SHA-256 of downloaded document: \`${sha256}\`
- Paths: ${paths}
- Operations: ${operations}

## Reproduce

From a clean clone, no manual lookup is needed:

\`\`\`sh
npm install
npm run generate
\`\`\`

\`openapi-ts.config.ts\` reads \`./openapi/jira-cloud-v3.json\` (the pinned file).
Run \`npm run download-spec\` to refresh the pin; this rewrites both the JSON
and this file. Regeneration output goes to \`src/generated/\` and must never be
hand-edited (see AGENTS.md).
`;
  writeFileSync(sourcePath, sourceMd);
  console.log(`Pinned ${operations} operations across ${paths} paths (sha256: ${sha256.slice(0, 12)}…).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
