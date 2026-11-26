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

// What pr.yml's review job and migration-order.yml run or read from the PR
// head with a token that can post reviews as github-actions[bot]. A PR that
// edits any of it could forge the review bot's verdict, so the match fails
// closed. go.mod/go.sum count at any depth: go.work builds the tools from
// every module's requirements. List: dev/docs/LOW_RISK_PULL_REQUESTS.md
const REVIEW_PIPELINE_PATH =
  /^(?:[^/]+$|\.github\/|cmd\/|tools\/|pkg\/ciscan\/)|(?:^|\/)(?:\.claude\/|\.mcp\.json$|(?:CLAUDE|AGENTS)\.md$|go\.(?:mod|sum)$)/;

// Same rule as tools/waitforchecks: these conclusions do not fail a check.
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

// The only paths the low-risk path may approve on, whatever the model says
// (the PR it reads can persuade it). Not every .md: a SKILL.md or prompt file
// ships as agent instructions. Not .svg outside docs/: it can carry script.
const LOW_RISK_PATH = /^(?:docs|dev\/docs|specs)\/|(?:^|\/)README\.mdx?$|\.(?:png|jpe?g|gif|webp)$/;

/** True when any changed path is one the review job executes from the PR head. */
const touchesReviewPipeline = (files) => files.some((file) => REVIEW_PIPELINE_PATH.test(file));

/** True when every changed path is on the low-risk allowlist and none is in the review pipeline. */
const lowRiskPathsOnly = (files) =>
  files.length > 0 &&
  files.every((file) => LOW_RISK_PATH.test(file)) &&
  !touchesReviewPipeline(files);

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
 * Required checks from rulesets and branch protection (GitHub enforces both),
 * as { context, appId }; appId is the app that must report it, if pinned.
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
  for (const check of [...fromRules, ...fromProtection])
    unique.set(`${check.context}\0${check.appId}`, check);
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

/** Every source's newest result for a required check: a conclusion, a status state or "pending". */
const resultsFor = ({ context, appId }, runs, statuses, appBots) => [
  ...runs
    .filter((run) => run.name === context && (appId === undefined || run.app?.id === appId))
    .map((run) => (run.status === "completed" ? run.conclusion : "pending")),
  ...statuses
    .filter(
      (status) =>
        status.context === context &&
        (appId === undefined || status.creator?.login === appBots.get(appId)),
    )
    .map((status) => status.state),
];

/**
 * Whether every required check passed on the head commit. Every source's
 * newest result must pass, so another app cannot stand in for the real one;
 * a check pinned to an app reads only its runs and its bot's statuses.
 * @param {{ context: string, appId?: number }[]} required  from requiredChecksFrom
 * @param {object[]} checkRuns  checks.listForRef payload for the head sha
 * @param {object[]} statuses   repos.listCommitStatusesForRef payload (it names each creator)
 */
const requiredChecksVerdict = (required, checkRuns, statuses) => {
  const runs = newestBy(checkRuns, (run) => `${run.name}\0${run.app?.id}`);
  const latestStatuses = newestBy(
    statuses,
    (status) => `${status.context}\0${status.creator?.login}`,
  );
  const appBots = new Map(
    checkRuns.filter((run) => run.app?.slug).map((run) => [run.app.id, `${run.app.slug}[bot]`]),
  );
  const pending = [];
  const failed = [];
  for (const check of required) {
    const results = resultsFor(check, runs, latestStatuses, appBots);
    const failing = results.find(
      (result) => result !== "pending" && !PASSING_CONCLUSIONS.has(result),
    );
    if (failing) failed.push(`${check.context} (${failing})`);
    else if (results.length === 0 || results.includes("pending")) pending.push(check.context);
  }

  return {
    green: required.length > 0 && pending.length === 0 && failed.length === 0,
    pending,
    failed,
  };
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
  const {
    runHeadSha,
    prHeadSha,
    labels,
    reviews,
    files,
    filesComplete,
    required,
    checkRuns,
    statuses,
  } = input;

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
    const detail = [...checks.failed, ...checks.pending.map((name) => `${name} (pending)`)].join(
      ", ",
    );
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
