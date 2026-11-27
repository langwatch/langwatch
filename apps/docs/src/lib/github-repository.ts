/** The public repository's API address, read at build time and live in the browser. */
export const REPOSITORY_API_URL = "https://api.github.com/repos/langwatch/langwatch";
export const GITHUB_ACCEPT = "application/vnd.github+json";

/** The star count in a repository API answer, or null when it holds none. */
export function starCount({ body }: { body: unknown }): number | null {
  const count = (body as { stargazers_count?: unknown } | null)?.stargazers_count;
  return Number.isInteger(count) ? (count as number) : null;
}
