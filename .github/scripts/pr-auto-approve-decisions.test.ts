import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  aiReviewedLaneVerdict,
  checkSignals,
  dependabotLaneVerdict,
  latestCountableReview,
  lowRiskLaneVerdict,
  parseVerdictTrailer,
  reviewFreshness,
  shaCoversHead,
} from "./pr-auto-approve-decisions.cjs";

const HEAD = "aaaa111122223333444455556666777788889999";
const OLD = "bbbb111122223333444455556666777788889999";

// The live pattern from the workflow itself, so the tests judge what ships,
// not a copy that can drift.
const workflowText = readFileSync(
  new URL("../workflows/pr-auto-approve.yml", import.meta.url),
  "utf8",
);
const patternLine = workflowText.match(/^\s*RESTRICTED_PATTERN:\s*'(.+)'\s*$/m);
assert.ok(patternLine, "pr-auto-approve.yml no longer defines RESTRICTED_PATTERN");
const RESTRICTED_PATTERN = patternLine[1];

const review = ({
  login = "langwatch-agent",
  body = "",
  commitId = HEAD,
  state = "COMMENTED",
  submittedAt = "2026-08-10T12:00:00Z",
}) => ({
  user: { login },
  body,
  commit_id: commitId,
  state,
  submitted_at: submittedAt,
  html_url: "https://github.com/langwatch/langwatch/pull/1#pullrequestreview-1",
});

const trailer = (verdict: string, sha: string) => `LangWatch-Review: verdict=${verdict} sha=${sha}`;

const cleanSignalsInput = () => ({
  headSha: HEAD,
  restrictedPattern: RESTRICTED_PATTERN,
  threads: [],
  compare: async () => {
    throw new Error("compare must not be called when reviews cover the head");
  },
  reviews: [
    review({ login: "coderabbitai[bot]" }),
    review({ body: `LGTM.\n\n${trailer("clean", HEAD)}` }),
  ],
});

const dependabotCommit = ({
  login = "dependabot[bot]",
  committer = "web-flow",
  verified = true,
  sha = "abc123",
} = {}) => ({
  sha,
  author: { login },
  committer: { login: committer },
  commit: { verification: { verified } },
});

describe("pr-auto-approve decisions", () => {
  describe("when the Dependabot lane inspects branch commits", () => {
    /** @scenario "A purely Dependabot-authored PR is approved" */
    it("approves when every commit is Dependabot-authored and GitHub-verified", () => {
      const verdict = dependabotLaneVerdict([dependabotCommit(), dependabotCommit({ sha: "def456" })]);
      assert.equal(verdict.approve, true);
      assert.deepEqual(verdict.foreign, []);
    });

    /** @scenario "A human commit removes the Dependabot fast lane" */
    it("refuses the lane when any commit has a non-Dependabot author", () => {
      const verdict = dependabotLaneVerdict([
        dependabotCommit(),
        dependabotCommit({ login: "some-human", committer: "some-human", sha: "def456" }),
      ]);
      assert.equal(verdict.approve, false);
      assert.deepEqual(verdict.foreign, [
        { sha: "def456", login: "some-human", committer: "some-human", verified: true },
      ]);
    });

    /** @scenario "A spoofed Dependabot author without a verified commit does not approve" */
    it("refuses the lane when a commit claims the Dependabot author but is unverified", () => {
      const verdict = dependabotLaneVerdict([dependabotCommit({ verified: false })]);
      assert.equal(verdict.approve, false);
      assert.deepEqual(verdict.foreign, [
        { sha: "abc123", login: "dependabot[bot]", committer: "web-flow", verified: false },
      ]);
    });

    /** @scenario "A verified commit whose committer is not GitHub does not approve" */
    it("refuses the lane when a verified commit was committed outside GitHub's own identities", () => {
      const verdict = dependabotLaneVerdict([dependabotCommit({ committer: "some-human" })]);
      assert.equal(verdict.approve, false);
      assert.deepEqual(verdict.foreign, [
        { sha: "abc123", login: "dependabot[bot]", committer: "some-human", verified: true },
      ]);
    });

    it("refuses the lane for an empty commit list", () => {
      assert.equal(dependabotLaneVerdict([]).approve, false);
    });
  });

  describe("when coverage is computed from reviews", () => {
    /** @scenario "Coverage requires every required AI reviewer" */
    it("reports a gap for each required reviewer without a countable review", async () => {
      const input = cleanSignalsInput();
      input.reviews = [review({ login: "coderabbitai[bot]" })];
      const result = await checkSignals(input);
      assert.equal(result.ok, false);
      assert.equal(result.gaps.length, 1);
      assert.match(result.gaps[0], /LangWatch PR reviewer has not reviewed/);
    });

    /** @scenario "The LangWatch reviewer only counts via its verdict trailer" */
    it("ignores LangWatch reviewer reviews without a trailer", () => {
      const latest = latestCountableReview([review({ body: "Looks good, no trailer here." })], {
        login: "langwatch-agent",
        requireTrailer: true,
      });
      assert.equal(latest, null);
    });

    it("takes the last trailer when a body contains several", () => {
      const body = `${trailer("findings", OLD)}\nre-checked after fixes\n${trailer("clean", HEAD)}`;
      assert.deepEqual(parseVerdictTrailer(body), { verdict: "clean", sha: HEAD });
    });

    /** @scenario "A findings verdict from the LangWatch reviewer blocks the lane" */
    it("blocks the lane while the latest trailer verdict is findings", async () => {
      const input = cleanSignalsInput();
      input.reviews = [
        review({ login: "coderabbitai[bot]" }),
        review({ body: `Two problems.\n\n${trailer("findings", HEAD)}` }),
      ];
      const result = await checkSignals(input);
      assert.equal(result.ok, false);
      assert.match(result.gaps[0], /verdict=findings/);
    });

    /** @scenario "A dismissed review never counts as coverage" */
    it("skips dismissed reviews even when their trailer covers the head", async () => {
      const input = cleanSignalsInput();
      input.reviews = [
        review({ login: "coderabbitai[bot]" }),
        review({ body: `LGTM.\n\n${trailer("clean", HEAD)}`, state: "DISMISSED" }),
      ];
      const result = await checkSignals(input);
      assert.equal(result.ok, false);
      assert.match(result.gaps[0], /has not reviewed/);
    });

    it("passes when both required reviewers cleanly cover the head", async () => {
      const result = await checkSignals(cleanSignalsInput());
      assert.equal(result.ok, true);
      assert.deepEqual(result.gaps, []);
      assert.equal(result.summaryLines.length, 3);
    });

    it("matches abbreviated and uppercase trailer SHAs against the head", () => {
      assert.equal(shaCoversHead(HEAD, HEAD.slice(0, 12).toUpperCase()), true);
      assert.equal(shaCoversHead(HEAD, "aaaa11"), false);
      assert.equal(shaCoversHead(HEAD, OLD), false);
    });
  });

  describe("when a review covers an older SHA", () => {
    const restricted = new RegExp(RESTRICTED_PATTERN);
    const modified = (filename: string, additions: number, deletions = 0) => ({
      filename,
      status: "modified",
      additions,
      deletions,
    });

    /** @scenario "Trivial tweaks after a review keep it fresh" */
    it("keeps the review fresh for a small interdiff to existing files", async () => {
      const result = await reviewFreshness({
        headSha: HEAD,
        sha: OLD,
        restricted,
        compare: async () => ({
          status: "ahead",
          total_commits: 1,
          files: [modified("platform/app/src/foo.ts", 10, 5)],
        }),
      });
      assert.equal(result.fresh, true);
    });

    /** @scenario "Fundamental changes after a review make it stale" */
    it("marks the review stale past the trivial line limit, on added files, and on restricted paths", async () => {
      const cases = [
        { files: [modified("platform/app/src/foo.ts", 60)], why: /lines changed since the review/ },
        {
          files: [{ filename: "platform/app/src/new.ts", status: "added", additions: 3, deletions: 0 }],
          why: /added, removed, or renamed/,
        },
        { files: [modified(".github/workflows/ci.yml", 2)], why: /restricted paths/ },
      ];
      for (const { files, why } of cases) {
        const result = await reviewFreshness({
          headSha: HEAD,
          sha: OLD,
          restricted,
          compare: async () => ({ status: "ahead", total_commits: 1, files }),
        });
        assert.equal(result.fresh, false);
        assert.match(result.why, why);
      }
    });

    /** @scenario "A force-push always makes prior reviews stale" */
    it("marks the review stale when the reviewed SHA is no longer comparable", async () => {
      const result = await reviewFreshness({
        headSha: HEAD,
        sha: OLD,
        restricted,
        compare: async () => {
          throw Object.assign(new Error("Not Found"), { status: 404 });
        },
      });
      assert.equal(result.fresh, false);
      assert.match(result.why, /force-push/);
    });

    it("treats an identical comparison as covering the head", async () => {
      const result = await reviewFreshness({
        headSha: HEAD,
        sha: OLD,
        restricted,
        compare: async () => ({ status: "identical", total_commits: 0, files: [] }),
      });
      assert.equal(result.fresh, true);
    });

    it("marks the review stale when the branch diverged", async () => {
      const result = await reviewFreshness({
        headSha: HEAD,
        sha: OLD,
        restricted,
        compare: async () => ({ status: "diverged", total_commits: 2, files: [] }),
      });
      assert.equal(result.fresh, false);
    });

    it("fails closed when the comparison omits line counts", async () => {
      const result = await reviewFreshness({
        headSha: HEAD,
        sha: OLD,
        restricted,
        compare: async () => ({
          status: "ahead",
          total_commits: 1,
          files: [{ filename: "platform/app/src/foo.ts", status: "modified" }],
        }),
      });
      assert.equal(result.fresh, false);
    });
  });

  describe("when review threads are open", () => {
    /** @scenario "Unresolved AI review threads block approval" */
    it("blocks the lane while a required reviewer's thread is unresolved", async () => {
      const input = cleanSignalsInput();
      input.threads = [
        { isResolved: false, firstAuthorLogin: "coderabbitai" },
        { isResolved: true, firstAuthorLogin: "langwatch-agent" },
        { isResolved: false, firstAuthorLogin: "some-human" },
      ];
      const result = await checkSignals(input);
      assert.equal(result.ok, false);
      assert.match(result.gaps[0], /1 unresolved review thread/);
    });
  });

  describe("when the impact evaluation reaches a lane verdict", () => {
    const base = { oversized: false, blocked: false, touchesExcludedAreas: false };

    /** @scenario "High impact disqualifies regardless of clean reviews" */
    it("refuses the AI-reviewed lane for high impact or excluded areas", () => {
      assert.equal(aiReviewedLaneVerdict({ ...base, impact: "high" }), false);
      assert.equal(aiReviewedLaneVerdict({ ...base, impact: "medium", touchesExcludedAreas: true }), false);
      assert.equal(aiReviewedLaneVerdict({ ...base, impact: "medium" }), true);
      assert.equal(aiReviewedLaneVerdict({ ...base, impact: "low" }), true);
      assert.equal(aiReviewedLaneVerdict({ ...base, impact: "medium", oversized: true }), false);
      assert.equal(aiReviewedLaneVerdict({ ...base, impact: "medium", blocked: true }), false);
    });

    it("grants the low-risk lane only for a qualifying low-impact change", () => {
      assert.equal(lowRiskLaneVerdict({ ...base, impact: "low", lowRiskQualifies: true }), true);
      assert.equal(lowRiskLaneVerdict({ ...base, impact: "low", lowRiskQualifies: false }), false);
      assert.equal(lowRiskLaneVerdict({ ...base, impact: "medium", lowRiskQualifies: true }), false);
      assert.equal(lowRiskLaneVerdict({ ...base, impact: "", lowRiskQualifies: true }), false);
      assert.equal(
        lowRiskLaneVerdict({ ...base, impact: "low", lowRiskQualifies: true, touchesExcludedAreas: true }),
        false,
      );
      assert.equal(
        lowRiskLaneVerdict({ ...base, impact: "low", lowRiskQualifies: true, oversized: true }),
        false,
      );
      assert.equal(
        lowRiskLaneVerdict({ ...base, impact: "low", lowRiskQualifies: true, blocked: true }),
        false,
      );
    });
  });

  describe("when a PR touches the restricted paths", () => {
    const restricted = new RegExp(RESTRICTED_PATTERN);

    /** @scenario "The policy documents cannot approve their own changes" */
    it("marks the policy documents and workflows as restricted in the shipped pattern", () => {
      const mustBeRestricted = [
        ".github/workflows/pr-auto-approve.yml",
        "dev/docs/LOW_RISK_PULL_REQUESTS.md",
        "dev/docs/AI_REVIEWED_PULL_REQUESTS.md",
        "dev/docs/PR_IMPACT_EVALUATION.md",
        "platform/app/prisma/schema.prisma",
        "platform/app/src/server/auth/session.ts",
      ];
      for (const path of mustBeRestricted) {
        assert.equal(restricted.test(path), true, `${path} must match RESTRICTED_PATTERN`);
      }
      for (const path of ["platform/app/src/components/Button.tsx", "README.md"]) {
        assert.equal(restricted.test(path), false, `${path} must not match RESTRICTED_PATTERN`);
      }
    });
  });
});
