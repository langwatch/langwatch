import type { Snippet } from "./generatePromptApiSnippet";

export function replaceVariables(
  snippet: Snippet,
  variables: Record<string, string>
): Snippet {
  const content = snippet.content.replace(
    /\{\{([^}]+)\}\}/g,
    (match, p1) => variables[p1] || match
  );
  return { ...snippet, content };
}
