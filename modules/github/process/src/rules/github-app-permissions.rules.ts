/** What an installation token is minted with unless the caller names its own. */
export const GITHUB_WRITE_PERMISSIONS: Record<string, string> = {
  contents: "write",
  pull_requests: "write",
};

export const GITHUB_READ_PULL_PERMISSIONS: Record<string, string> = {
  pull_requests: "read",
};

/** What reading a commit's finished checks and its pull requests needs. */
export const GITHUB_READ_CHECKS_PERMISSIONS: Record<string, string> = {
  checks: "read",
  pull_requests: "read",
};

/**
 * What a Langy turn would like beyond the write pair: run and read the repository's CI
 * (actions), read check runs (checks) and push workflow files (workflows). An installation
 * registered before these were asked for keeps working on the write pair alone.
 */
export const GITHUB_TURN_OPTIONAL_PERMISSIONS: Record<string, string> = {
  actions: "write",
  checks: "read",
  workflows: "write",
};

const ACCESS_RANK: Record<string, number> = { read: 1, write: 2 };

/**
 * The permissions a token asks for: the required ones always, plus each optional permission at
 * the lower of what is wanted and what the installation granted. GitHub refuses a mint that asks
 * for anything the installation never granted, so asking for less keeps old installs working.
 */
export function permissionsWithinGrant({
  required,
  optional,
  granted,
}: {
  required: Record<string, string>;
  optional: Record<string, string>;
  granted: Record<string, string>;
}): Record<string, string> {
  const permissions: Record<string, string> = { ...required };
  for (const [name, wanted] of Object.entries(optional)) {
    const has = ACCESS_RANK[granted[name] ?? ""] ?? 0;
    const wants = ACCESS_RANK[wanted] ?? 0;
    const level = Math.min(has, wants);
    if (level === 0) continue;
    permissions[name] = level === 2 ? "write" : "read";
  }
  return permissions;
}
