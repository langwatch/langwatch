/** What an installation token is minted with unless the caller names its own. */
export const GITHUB_WRITE_PERMISSIONS: Record<string, string> = {
  contents: "write",
  pull_requests: "write",
};

export const GITHUB_READ_PULL_PERMISSIONS: Record<string, string> = {
  pull_requests: "read",
};
