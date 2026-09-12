// Fetch a single issue by key. Mirrors the README quickstart.
import { createJiraClient, getIssue, throwIfJiraError } from '../src/index.js';

const baseUrl = process.env['JIRA_BASE_URL'];
const email = process.env['JIRA_EMAIL'];
const apiToken = process.env['JIRA_API_TOKEN'];
if (baseUrl === undefined || email === undefined || apiToken === undefined) {
  throw new Error('Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.');
}

const client = createJiraClient({ baseUrl, auth: { type: 'basic', email, apiToken } });

const issue = await getIssue({ client, path: { issueIdOrKey: 'PROJ-1' } }).then(throwIfJiraError);
console.log(issue.key, issue.fields?.summary);
