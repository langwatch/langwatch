// Decides whether github-actions[bot] approves a PR that the low-risk path did
// not approve, once the pr workflow (CI + the review bot) has finished on it.
// Pure functions over GitHub API payloads, so the decision tree is testable
// without a runner. Used by pr-reviewed-approve.yml and pr-auto-approve.yml;
// spec: specs/ci/pr-auto-approve.feature

const BOT_LOGIN = "github-actions[bot]";
const NEEDS_ACK_LABEL = "needs-ack";
const LOW_RISK_LABEL = "low-risk-change";
const FIREFIGHTING_LABEL = "firefighting";

// Markers langwatch/langwatch-pr-review-bot puts on its own reviews. Its
// infrastructure-error notice is a COMMENT too, but it is not a verdict.
const REVIEW_BOT_PREFIX = "**@LangWatchReviewBot**";
const INFRA_ERROR_MARKER = "<!-- review-infra-error -->";

// The review job in pr.yml runs code and config from the PR head (setup-go,
// `go run ./cmd/waitforchecks`, npm and Claude Code in the checkout) with a
// token that can post reviews as github-actions[bot]; so does
// migration-order.yml (`go run ./cmd/migrationorder`, which compiles
// pkg/ciscan). A PR that edits any of it could forge the review bot's verdict,
// so the match fails closed: every root-level file (.npmrc, go.work,
// package.json, ...), .github/, cmd/, tools/, pkg/ciscan/, and at any depth a
// .claude/ directory, a CLAUDE.md or AGENTS.md, or a go.mod/go.sum (go.work
// builds those tools from every workspace module's requirements).
const REVIEW_PIPELINE_PATH =
  /^(?:[^/]+$|\.github\/|cmd\/|tools\/|pkg\/ciscan\/)|(?:^|\/)(?:\.claude\/|(?:CLAUDE|AGENTS)\.md$|go\.(?:mod|sum)$)/;

// Same rule as tools/waitforchecks: these conclusions do not fail a check.
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

// The only paths the low-risk path may approve on, whatever the model says:
// docs/, dev/docs/, specs/, a README, and raster images. Not every .md: a
// SKILL.md or prompt file ships as agent instructions. Not .svg outside docs/:
// it can carry script. The model's verdict alone is persuadable by the PR it
// reads, so it can only narrow this list.
const LOW_RISK_PATH = /^(?:docs|dev\/docs|specs)\/|(?:^|\/)README\.mdx?$|\.(?:png|jpe?g|gif|webp)$/;

/** True when any changed path is one the review job executes from the PR head. */
const touchesReviewPipeline = (files) => files.some((file) => REVIEW_PIPELINE_PATH.test(file));

/** True when every changed path is on the low-risk allowlist and none is in the review pipeline. */
const lowRiskPathsOnly = (files) =>
  files.length > 0 && files.every((file) => LOW_RISK_PATH.test(file)) && !touchesReviewPipeline(files);

/**
 * The review bot's latest verdict on headSha: "pass" (COMMENT, no P0/P1),
 * "changes-requested", "infra-error", "dismissed", or "none" when it has not
 * reviewed that commit.
 */
const reviewBotVerdict = (reviews, headSha) => {
  const latest = reviews
    .filter(
      (review) =>
        review.user?.login === BOT_LOGIN &&
        review.commit_id === headSha &&
        (review.body ?? "").startsWith(REVIEW_BOT_PREFIX),
    )
    .reduce((newest, review) => (!newest || review.id > newest.id ? review : newest), undefined);

  if (!latest) return "none";
  if (latest.state === "CHANGES_REQUESTED") return "changes-requested";
  if (latest.state === "DISMISSED") return "dismissed";
  if ((latest.body ?? "").includes(INFRA_ERROR_MARKER)) return "infra-error";
  return latest.state === "COMMENTED" ? "pass" : "none";
};

/**
 * The required checks the base branch names, from rulesets and from classic
 * branch protection (GitHub enforces both), as { context, appId }. appId is
 * the app that must report it, or undefined when any source counts.
 *
 * @param {object[]} rules       rules/branches/{branch} payload
 * @param {object} [protection]  repos.getBranch().protection
 */
const requiredChecksFrom = (rules, protection) => {
  const fromRules = rules
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => ({ context: check.context, appId: check.integration_id ?? undefined }));
  const fromProtection = (protection?.required_status_checks?.checks ?? []).map((check) => ({
    context: check.context,
    appId: check.app_id ?? undefined,
  }));
  const unique = new Map();
  for (const check of [...fromRules, ...fromProtection]) unique.set(`${check.context}\0${check.appId}`, check);
  return [...unique.values()];
};

/** The newest item (highest id) per key. */
const newestBy = (items, keyOf) => {
  const newest = new Map();
  for (const item of items) {
    const seen = newest.get(keyOf(item));
    if (!seen || item.id > seen.id) newest.set(keyOf(item), item);
  }
  return [...newest.values()];
};

/**
 * Whether every required check is finished and passing on the head commit, as
 * check runs and commit statuses. Each is read newest per name and source (app
 * or status creator), and every source's latest result must pass, so a
 * same-name result from another source cannot stand in for the real one. A
 * check pinned to an app reads only that app's runs and the statuses its bot
 * created. A required check with no result yet is pending; an empty required
 * list is never green.
 *
 * @param {{ context: string, appId?: number }[]} required  from requiredChecksFrom
 * @param {object[]} checkRuns  checks.listForRef payload for the head sha
 * @param {object[]} statuses   repos.listCommitStatusesForRef payload (it names each creator)
 */
const requiredChecksVerdict = (required, checkRuns, statuses) => {
  const runs = newestBy(checkRuns, (run) => `${run.name}\0${run.app?.id}`);
  const latestStatuses = newestBy(statuses, (status) => `${status.context}\0${status.creator?.login}`);
  const appBots = new Map(checkRuns.filter((run) => run.app?.slug).map((run) => [run.app.id, `${run.app.slug}[bot]`]));

  const pending = [];
  const failed = [];
  for (const { context, appId } of required) {
    const results = [
      ...runs
        .filter((run) => run.name === context && (appId === undefined || run.app?.id === appId))
        .map((run) => (run.status !== "completed" ? "pending" : run.conclusion)),
      ...latestStatuses
        .filter(
          (status) =>
            status.context === context && (appId === undefined || status.creator?.login === appBots.get(appId)),
        )
        .map((status) => (status.state === "success" ? "success" : status.state)),
    ];
    const failing = results.find((result) => result !== "pending" && !PASSING_CONCLUSIONS.has(result));
    if (failing) failed.push(`${context} (${failing})`);
    else if (results.length === 0 || results.includes("pending")) pending.push(context);
  }

  return { green: required.length > 0 && pending.length === 0 && failed.length === 0, pending, failed };
};

/**
 * The reviewed-approval decision tree, in order. Returns { approve, reason,
 * needsAck }; needsAck is true when the approved PR is not low risk.
 *
 * @param {object} input
 * @param {string} input.runHeadSha   head_sha of the completed pr workflow run
 * @param {string} input.prHeadSha    the PR's current head sha
 * @param {string[]} input.labels     the PR's label names
 * @param {object[]} input.reviews    pulls.listReviews payload
 * @param {string[]} input.files      changed paths (pulls.listFiles)
 * @param {boolean} input.filesComplete false when the file list was capped
 * @param {{ context: string, appId?: number }[]} input.required  requiredChecksFrom output
 * @param {object[]} input.checkRuns  checks.listForRef payload for the head sha
 * @param {object[]} input.statuses   repos.listCommitStatusesForRef payload for the head sha
 */
const decideReviewedApproval = (input) => {
  const { runHeadSha, prHeadSha, labels, reviews, files, filesComplete, required, checkRuns, statuses } =
    input;

  if (runHeadSha !== prHeadSha) return skip(`stale run: PR head moved to ${prHeadSha}`);
  if (reviews.some((review) => review.state === "APPROVED" && review.commit_id === prHeadSha)) {
    return skip("already approved on the head commit");
  }
  if (labels.includes(FIREFIGHTING_LABEL)) return skip("firefighting path owns this PR");
  if (!filesComplete || touchesReviewPipeline(files)) {
    return skip("changes the review pipeline; a human must approve");
  }

  const verdict = reviewBotVerdict(reviews, prHeadSha);
  if (verdict !== "pass") return skip(`review bot verdict on the head commit: ${verdict}`);

  const checks = requiredChecksVerdict(required, checkRuns, statuses);
  if (!checks.green) {
    const detail = [...checks.failed, ...checks.pending.map((name) => `${name} (pending)`)].join(", ");
    return skip(`required checks not green: ${detail || "none required"}`);
  }

  return {
    approve: true,
    reason: "review bot found no P0/P1 and required checks are green",
    needsAck: !labels.includes(LOW_RISK_LABEL),
  };
};

const skip = (reason) => ({ approve: false, reason, needsAck: false });

/**
 * Model output put into a PR comment: one line, so it cannot break out of the
 * blockquote it sits in, with @mentions broken (zero-width space after "@") so
 * text the PR steered the model into cannot ping anyone.
 */
const untrustedLine = (text) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/@/g, "@\u200b");

module.exports = {
  BOT_LOGIN,
  FIREFIGHTING_LABEL,
  LOW_RISK_LABEL,
  NEEDS_ACK_LABEL,
  decideReviewedApproval,
  lowRiskPathsOnly,
  requiredChecksFrom,
  requiredChecksVerdict,
  reviewBotVerdict,
  touchesReviewPipeline,
  untrustedLine,
};
