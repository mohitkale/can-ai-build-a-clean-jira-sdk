// Create an issue with a typed body, retrying transient failures.
import { createIssue, createJiraClient, throwIfJiraError, withRetry } from '../src/index.js';

const baseUrl = process.env['JIRA_BASE_URL'];
const email = process.env['JIRA_EMAIL'];
const apiToken = process.env['JIRA_API_TOKEN'];
if (baseUrl === undefined || email === undefined || apiToken === undefined) {
  throw new Error('Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.');
}

const client = createJiraClient({ baseUrl, auth: { type: 'basic', email, apiToken } });

const created = await withRetry(() =>
  createIssue({
    client,
    body: {
      fields: {
        project: { key: 'PROJ' },
        summary: 'Filed from jira-cloud-v3-sdk',
        issuetype: { name: 'Task' },
      },
    },
  }).then(throwIfJiraError),
);
console.log('Created', created.key);
