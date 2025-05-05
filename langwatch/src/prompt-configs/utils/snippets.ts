import type { Snippet } from "../types";

/**
 * Returns code snippets for getting prompts from the LangWatch API
 * @param promptId - The ID of the prompt to retrieve (defaults to "{id}")
 * @param apiKey - The API key to use for authentication (defaults to "YOUR_API_KEY")
 * @returns Array of code snippets for getting prompts
 */
export function getGetPromptSnippets(params?: {
  promptId?: string;
  apiKey?: string;
}): Snippet[] {
  const { promptId = "{id}", apiKey = "YOUR_API_KEY" } = params ?? {};

  return [
    {
      content: `curl -X GET "https://app.langwatch.ai/api/prompts/${promptId}" \\
  -H "X-Auth-Token: ${apiKey}" \\
  -H "Content-Type: application/json"`,
      target: "shell_curl",
      title: "Get Prompts",
    },
    {
      content: `import requests

url = "https://app.langwatch.ai/api/prompts/${promptId}"
headers = {
    "X-Auth-Token": "${apiKey}",
    "Content-Type": "application/json"
}

response = requests.get(url, headers=headers)
print(response.json())`,
      target: "python_requests",
      title: "Get Prompts",
    },
    {
      content: `const fetch = require('node-fetch');

const url = 'https://app.langwatch.ai/api/prompts/${promptId}';
const options = {
  method: 'GET',
  headers: {
    'X-Auth-Token': '${apiKey}',
    'Content-Type': 'application/json'
  }
};

fetch(url, options)
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`,
      target: "node_native",
      title: "Get Prompts",
    },
  ];
}
