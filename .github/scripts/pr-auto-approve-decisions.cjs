"use strict";

/**
 * Decision logic for `.github/workflows/pr-auto-approve.yml`.
 *
 * Plain CommonJS so the workflow's `actions/github-script` steps can
 * `require()` it straight from the base-branch checkout — the same
 * trust boundary as the policy documents: a PR can never rewrite the
 * rules that judge it, because the workflow reads this file from base.
 *
 * Everything here is a pure decision over data the workflow fetched;
 * all GitHub API I/O stays in the workflow (the one async function,
 * `reviewFreshness`, receives the compare call as a callback). That
 * split is what makes the lane rules testable:
 * `pr-auto-approve-decisions.test.ts` binds the scenarios in
 * `specs/ci/pr-auto-approve.feature`.
 */

/**
 * Machine-readable verdict trailer the LangWatch PR reviewer embeds in its
 * review bodies (contract: saas agents-box review skill). Parsed leniently
 * from anywhere in the body; the last trailer wins.
 */
const TRAILER_RE = /LangWatch-Review:\s*verdict=(clean|findings)\s+sha=([0-9a-fA-F]{7,40})/g;

/**
 * "A few tweaks here and there" stay covered by an earlier review;
 * anything past this many changed lines is a fundamental change that
 * needs a fresh review of the new head.
 */
const TRIVIAL_LINE_LIMIT = 50;

/**
 * The reviewers whose clean, head-covering reviews the AI-reviewed lane
 * requires. CodeRabbit counts via its review's `commit_id`; the LangWatch
 * reviewer only via its verdict trailer (author identity + trailer content
 * are the trusted parts).
 */
const REQUIRED_REVIEWERS = [
  { name: "CodeRabbit", login: "coderabbitai[bot]", requireTrailer: false },
  { name: "LangWatch PR reviewer", login: "langwatch-agent", requireTrailer: true },
];

function parseVerdictTrailer(body) {
  const matches = [...(body || "").matchAll(TRAILER_RE)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return { verdict: last[1], sha: last[2].toLowerCase() };
}

/**
 * The most recent review from `login` that can count as coverage.
 * Dismissed reviews never count — a dismissal is an explicit statement
 * that the review no longer stands. For trailer-required reviewers the
 * verdict travels with the result so callers can reject `findings`.
 */
function latestCountableReview(reviews, { login, requireTrailer }) {
  const own = reviews
    .filter((r) => r.user?.login === login && r.submitted_at && r.state !== "DISMISSED")
    .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  for (let i = own.length - 1; i >= 0; i--) {
    const review = own[i];
    if (!requireTrailer) {
      if (review.commit_id) return { review, sha: review.commit_id.toLowerCase(), verdict: null };
      continue;
    }
    const trailer = parseVerdictTrailer(review.body);
    if (trailer) return { review, sha: trailer.sha, verdict: trailer.verdict };
  }
  return null;
}

/**
 * Trailer SHAs may arrive in any case and abbreviated to >= 7 hex chars;
 * the head SHA from the API is full-length lowercase.
 */
function shaCoversHead(headSha, sha) {
  const head = (headSha || "").toLowerCase();
  const reviewed = (sha || "").toLowerCase();
  if (!head || !reviewed) return false;
  return head === reviewed || (reviewed.length >= 7 && head.startsWith(reviewed));
}

/**
 * Whether a review of `sha` still covers `headSha`. `compare` performs the
 * GitHub basehead comparison (`"<sha>...<headSha>"`) and resolves to the
 * comparison data, or rejects when the reviewed SHA is gone (force-push).
 */
async function reviewFreshness({ headSha, sha, compare, restricted, trivialLineLimit = TRIVIAL_LINE_LIMIT }) {
  if (shaCoversHead(headSha, sha)) {
    return { fresh: true, why: "reviewed the current head" };
  }
  let cmp;
  try {
    cmp = await compare(`${sha}...${headSha}`);
  } catch {
    return { fresh: false, why: `reviewed SHA ${sha} is not comparable to the head (force-push?)` };
  }
  if (cmp.status === "identical") {
    return { fresh: true, why: "reviewed the current head" };
  }
  if (cmp.status !== "ahead") {
    return { fresh: false, why: `branch is ${cmp.status} relative to the reviewed SHA` };
  }
  const files = cmp.files ?? [];
  // The compare API caps the file list; a capped or absent list means the
  // interdiff is far past trivial anyway.
  if (files.length >= 300 || (cmp.total_commits > 0 && files.length === 0)) {
    return { fresh: false, why: "interdiff too large to verify as trivial" };
  }
  const changed = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (changed > trivialLineLimit) {
    return { fresh: false, why: `${changed} lines changed since the review (> ${trivialLineLimit})` };
  }
  if (files.some((f) => f.status !== "modified")) {
    return { fresh: false, why: "files were added, removed, or renamed since the review" };
  }
  if (files.some((f) => restricted.test(f.filename))) {
    return { fresh: false, why: "restricted paths were touched since the review" };
  }
  return { fresh: true, why: `only trivial tweaks since the reviewed SHA (${changed} lines)` };
}

/**
 * Unresolved review threads opened by a required reviewer. GraphQL reports
 * Bot actors without the "[bot]" suffix, so both sides are normalized.
 * `threads` is the flattened form the workflow builds from the reviewThreads
 * query: `{ isResolved, firstAuthorLogin }`.
 */
function countUnresolvedRequiredThreads(threads, requiredReviewers = REQUIRED_REVIEWERS) {
  const required = new Set(requiredReviewers.map((r) => r.login.replace(/\[bot\]$/, "")));
  return threads.filter((t) => {
    const author = (t.firstAuthorLogin || "").replace(/\[bot\]$/, "");
    return !t.isResolved && author && required.has(author);
  }).length;
}

/**
 * The AI-reviewed lane's signal check: every required reviewer has a
 * countable, clean, head-covering review, and no unresolved threads from
 * them remain. Returns `ok` with either the human-readable `gaps` that
 * block the lane (transient — the workflow logs and waits) or the
 * `summaryLines` recorded in the assessment comment as audit evidence.
 */
async function checkSignals({
  reviews,
  threads,
  headSha,
  compare,
  restrictedPattern,
  requiredReviewers = REQUIRED_REVIEWERS,
  trivialLineLimit = TRIVIAL_LINE_LIMIT,
}) {
  const restricted = new RegExp(restrictedPattern);
  const gaps = [];
  const summaryLines = [];
  for (const reviewer of requiredReviewers) {
    const latest = latestCountableReview(reviews, reviewer);
    if (!latest) {
      gaps.push(
        `${reviewer.name} has not reviewed this PR${reviewer.requireTrailer ? " (no non-dismissed review with a verdict trailer)" : ""}`,
      );
      continue;
    }
    if (reviewer.requireTrailer && latest.verdict !== "clean") {
      gaps.push(
        `${reviewer.name}'s latest review reports verdict=${latest.verdict} — a clean review of the current head is required`,
      );
      continue;
    }
    const { fresh, why } = await reviewFreshness({
      headSha,
      sha: latest.sha,
      compare,
      restricted,
      trivialLineLimit,
    });
    if (!fresh) {
      gaps.push(`${reviewer.name}'s latest review (${latest.sha.slice(0, 12)}) is stale: ${why}`);
      continue;
    }
    summaryLines.push(
      `- **${reviewer.name}** — [review](${latest.review.html_url}) at \`${latest.sha.slice(0, 12)}\` (${why})`,
    );
  }
  const unresolved = countUnresolvedRequiredThreads(threads, requiredReviewers);
  if (unresolved > 0) {
    gaps.push(`${unresolved} unresolved review thread(s) from required AI reviewers`);
  } else {
    summaryLines.push("- **Outstanding comments:** none — no unresolved threads from required AI reviewers.");
  }
  return { ok: gaps.length === 0, gaps, summaryLines };
}

/**
 * The Dependabot lane approves only when every commit on the branch is
 * both authored by `dependabot[bot]` AND carries a GitHub-verified
 * signature — the author field alone is spoofable by anyone who can push
 * to the branch, the signature is not. `commits` is the REST
 * "list commits on a pull request" payload.
 */
function dependabotLaneVerdict(commits) {
  const foreign = commits.filter(
    (c) => c.author?.login !== "dependabot[bot]" || c.commit?.verification?.verified !== true,
  );
  return {
    approve: commits.length > 0 && foreign.length === 0,
    foreign: foreign.map((c) => ({
      sha: c.sha,
      login: c.author?.login ?? "unknown",
      verified: c.commit?.verification?.verified === true,
    })),
  };
}

/** Low-risk lane: classification alone merges it, so only `low` qualifies. */
function lowRiskLaneVerdict({ oversized, blocked, impact, touchesExcludedAreas, lowRiskQualifies }) {
  return (
    oversized !== true &&
    blocked !== true &&
    touchesExcludedAreas !== true &&
    lowRiskQualifies === true &&
    impact === "low"
  );
}

/** AI-reviewed lane: clean reviews are already established; impact may be medium. */
function aiReviewedLaneVerdict({ oversized, blocked, impact, touchesExcludedAreas }) {
  return (
    oversized !== true &&
    blocked !== true &&
    touchesExcludedAreas !== true &&
    (impact === "low" || impact === "medium")
  );
}

module.exports = {
  TRAILER_RE,
  TRIVIAL_LINE_LIMIT,
  REQUIRED_REVIEWERS,
  parseVerdictTrailer,
  latestCountableReview,
  shaCoversHead,
  reviewFreshness,
  countUnresolvedRequiredThreads,
  checkSignals,
  dependabotLaneVerdict,
  lowRiskLaneVerdict,
  aiReviewedLaneVerdict,
};
