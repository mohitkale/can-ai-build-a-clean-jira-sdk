// Walk every comment on an issue across offset-paginated pages.
//
// Comment search returns `PageOfComments`, which carries items in `comments`
// (not `values`), so the fetch callback adapts the real shape to the generic
// offset page at the call site — no endpoint-specific helper needed.
import { collectOffset, createJiraClient, getComments, throwIfJiraError } from '../src/index.js';

const baseUrl = process.env['JIRA_BASE_URL'];
const token = process.env['JIRA_BEARER_TOKEN'];
if (baseUrl === undefined || token === undefined) {
  throw new Error('Set JIRA_BASE_URL and JIRA_BEARER_TOKEN.');
}

const client = createJiraClient({ baseUrl, auth: { type: 'bearer', token } });

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
for (const comment of comments) console.log(comment.id, comment.created);
