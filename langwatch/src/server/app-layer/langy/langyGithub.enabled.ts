/**
 * GitHub is DISABLED in this PR (TODO #24 — the GitHub rewrite).
 *
 * The Langy GitHub flow — connecting an account, resolving the per-user GitHub
 * token, the per-user daily PR permit, and the turn-side PR flow (permit
 * reconcile + audit + PR card) — is deferred to #24. It is NOT deleted: every
 * GitHub file stays in the tree (re-adding it later would be painful and
 * error-prone). This single guard makes it inert so the self-drive rework can
 * ship without half-wired GitHub, and #24 flips it to `true` once the PR-flow
 * re-home lands.
 *
 * While `false`: no GitHub token is minted into a turn's credentials, so the Go
 * capability seam is inert (no token ⇒ no GitHub access); no PR permit is
 * reserved (so there is nothing to release — the M3b permit-release reactor also
 * lands with #24); and the "Connect GitHub" affordance is hidden.
 */
export const LANGY_GITHUB_ENABLED = false;
