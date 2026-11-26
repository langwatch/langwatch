// Where a run reads and writes Nx remote cache entries. The trust rule is in
// specs/ci/nx-remote-cache.feature: main trusts only CI, a laptop writes only its branch.
// The bucket policy enforces the same split, so a bug here cannot widen it.
const MAIN = "main/";
const PR = "pr/";

// Branch names go into an S3 key: anything outside [A-Za-z0-9._-] becomes "_".
const branchPrefix = (branch) =>
  `branch/${String(branch)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 200)}/`;

const ciScope = (env) => {
  const event = env.GITHUB_EVENT_NAME;
  if (env.GITHUB_REF === "refs/heads/main" && event === "push") {
    return {
      tier: "main",
      read: [{ prefix: MAIN }, { prefix: PR }],
      write: MAIN,
      taintedWrite: null,
    };
  }
  if (event !== "pull_request") return null;
  const own = env.GITHUB_HEAD_REF ? branchPrefix(env.GITHUB_HEAD_REF) : null;
  return {
    tier: "pr",
    read: [{ prefix: PR }, { prefix: MAIN }, ...(own ? [{ prefix: own, laptop: true }] : [])],
    write: PR,
    taintedWrite: own,
  };
};

const laptopScope = (localBranch) => {
  const shared = [{ prefix: MAIN }, { prefix: PR }];
  if (!localBranch || localBranch === "HEAD" || localBranch === "main") {
    return { tier: "laptop", read: shared, write: null, taintedWrite: null };
  }
  const own = branchPrefix(localBranch);
  return {
    tier: "laptop",
    read: [{ prefix: own, laptop: true }, ...shared],
    write: own,
    taintedWrite: own,
  };
};

/**
 * read: prefixes tried in order; `laptop: true` marks entries a laptop wrote.
 * write: where new entries go, or null for read only.
 * taintedWrite: where they go once a laptop entry was used in this job.
 */
export const cacheScope = ({ env, localBranch }) =>
  env.GITHUB_ACTIONS === "true" ? ciScope(env) : laptopScope(localBranch);

// Where a PUT goes: a job that used a laptop entry never writes the CI namespaces again.
export const writePrefixFor = ({ scope, tainted }) => (tainted ? scope.taintedWrite : scope.write);
