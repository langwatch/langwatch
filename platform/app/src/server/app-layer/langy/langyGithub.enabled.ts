/**
 * Master switch for the Langy GitHub flow (issue #4747).
 *
 * When `true`, a turn resolves a short-lived GitHub App INSTALLATION token
 * (minted per turn, scoped to the installation's repositories, 1h TTL) into the
 * worker credentials so the Go capability seam can open bot-authored PRs; the
 * per-user daily PR permit is reserved; and the "Install the LangWatch GitHub
 * App" affordance is shown.
 *
 * The feature is still bounded per instance by whether the GitHub App is
 * configured (`GITHUB_LANGY_PRIVATE_KEY` + id + slug). With this constant `true`
 * but the App unconfigured, `mintTurnToken` returns null and the worker's
 * capability seam stays inert — the connect card explains the App is
 * unavailable. This constant only enables the code path; env configures it.
 */
export const LANGY_GITHUB_ENABLED = true;
