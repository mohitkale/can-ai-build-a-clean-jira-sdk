import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/jira-cloud-v3.json',
  output: {
    path: './src/generated',
  },
  plugins: ['@hey-api/typescript', '@hey-api/client-axios', '@hey-api/sdk'],
});
