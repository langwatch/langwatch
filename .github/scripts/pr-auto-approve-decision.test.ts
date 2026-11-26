// Run with `node --test --experimental-strip-types`, like the other guards here.
// Spec: specs/ci/pr-auto-approve.feature
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

type Review = {
  id: number;
  user: { login: string };
  state: string;
  commit_id: string;
  body: string;
};
type Decision = { approve: boolean; reason: string; needsAck: boolean };

type RequiredCheck = { context: string; appId?: number };

const { decideReviewedApproval, lowRiskPathsOnly, requiredChecksFrom, untrustedLine } =
  createRequire(import.meta.url)("./pr-auto-approve-decision.cjs") as {
    decideReviewedApproval: (input: Record<string, unknown>) => Decision;
    requiredChecksFrom: (rules: object[], protection?: object) => RequiredCheck[];
    lowRiskPathsOnly: (files: string[]) => boolean;
    untrustedLine: (text: string) => string;
  };

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const BOT = "github-actions[bot]";
const ACTIONS_APP = 15368;
const NAMES = ["pr conventions", "codeql-complete", "ci-complete", "review"];
const REQUIRED: RequiredCheck[] = NAMES.map((context) =>
  context === "review" ? { context, appId: ACTIONS_APP } : { context },
);

const botReview = (id: number, state: string, extra = "", commit = HEAD): Review => ({
  id,
  user: { login: BOT },
  state,
  commit_id: commit,
  body: `**@LangWatchReviewBot** findings${extra}`,
});

const greenRuns = NAMES.map((name, index) => ({
  id: index + 1,
  name,
  app: { id: ACTIONS_APP, slug: "github-actions" },
  status: "completed",
  conclusion: name === "codeql-complete" ? "skipped" : "success",
}));

const status = (context: string, state: string, id = 1, creator = BOT) => ({
  id,
  context,
  state,
  creator: { login: creator },
});

const decide = (overrides: Record<string, unknown> = {}): Decision =>
  decideReviewedApproval({
    runHeadSha: HEAD,
    prHeadSha: HEAD,
    labels: [],
    reviews: [botReview(10, "COMMENTED")],
    files: ["langwatch/src/server/foo.ts"],
    filesComplete: true,
    required: REQUIRED,
    checkRuns: greenRuns,
    statuses: [],
    ...overrides,
  });

describe("reviewed-approval decision", () => {
  /** @scenario "A risky PR the review bot passed is approved and flagged for acknowledgement" */
  it("approves a risky PR the review bot passed, flagged needs-ack", () => {
    assert.deepEqual(decide(), {
      approve: true,
      reason: "review bot found no P0/P1 and required checks are green",
      needsAck: true,
    });
  });

  /** @scenario "A review bot REQUEST_CHANGES means no approval" */
  it("does not approve when the bot's latest review requests changes", () => {
    const decision = decide({
      reviews: [botReview(10, "COMMENTED"), botReview(11, "CHANGES_REQUESTED")],
    });
    assert.equal(decision.approve, false);
    assert.match(decision.reason, /changes-requested/);
  });

  /** @scenario "A review bot infrastructure error is not a verdict" */
  it("does not approve on the bot's infrastructure-error notice", () => {
    const decision = decide({
      reviews: [
        botReview(10, "COMMENTED"),
        botReview(12, "COMMENTED", "\n\n<!-- review-infra-error -->"),
      ],
    });
    assert.equal(decision.approve, false);
    assert.match(decision.reason, /infra-error/);
  });

  /** @scenario "A review of an older commit does not count" */
  it("does not count a clean review of an older commit, or a non-bot COMMENT", () => {
    const human: Review = { ...botReview(13, "COMMENTED"), user: { login: "someone" } };
    const forgedBody: Review = { ...botReview(14, "COMMENTED"), body: "looks fine" };
    const decision = decide({ reviews: [botReview(10, "COMMENTED", "", OLD), human, forgedBody] });
    assert.equal(decision.approve, false);
    assert.match(decision.reason, /none/);
  });

  /** @scenario "A required check that failed or has not finished means no approval" */
  it("does not approve when a required check failed, is running, or is missing", () => {
    const failed = greenRuns.map((run) =>
      run.name === "ci-complete" ? { ...run, conclusion: "failure" } : run,
    );
    assert.match(decide({ checkRuns: failed }).reason, /ci-complete \(failure\)/);

    const running = greenRuns.map((run) =>
      run.name === "pr conventions" ? { ...run, status: "in_progress", conclusion: null } : run,
    );
    assert.match(decide({ checkRuns: running }).reason, /pr conventions \(pending\)/);

    const missing = greenRuns.filter((run) => run.name !== "review");
    assert.equal(decide({ checkRuns: missing }).approve, false);

    assert.equal(decide({ required: [] }).approve, false, "no required checks is never green");
  });

  /** @scenario "A required check that failed or has not finished means no approval" */
  it("reads the newest run or status per name and source, pinned to the required app", () => {
    const rerunGreen = [
      ...greenRuns.map((run) => (run.name === "review" ? { ...run, conclusion: "failure" } : run)),
      {
        id: 99,
        name: "review",
        app: { id: ACTIONS_APP },
        status: "completed",
        conclusion: "success",
      },
    ];
    assert.equal(decide({ checkRuns: rerunGreen }).approve, true);

    const masked = [
      ...greenRuns.map((run) =>
        run.name === "ci-complete" ? { ...run, conclusion: "failure" } : run,
      ),
      { id: 98, name: "ci-complete", app: { id: 1 }, status: "completed", conclusion: "success" },
    ];
    assert.match(
      decide({ checkRuns: masked }).reason,
      /ci-complete \(failure\)/,
      "another app's run cannot mask it",
    );

    const pinned = [
      ...greenRuns.filter((run) => run.name !== "review"),
      { id: 97, name: "review", app: { id: 1 }, status: "completed", conclusion: "success" },
    ];
    assert.equal(
      decide({ checkRuns: pinned }).approve,
      false,
      "a check pinned to an app reads only its runs",
    );
    assert.equal(
      decide({ checkRuns: pinned, statuses: [status("review", "success", 1, "someone[bot]")] })
        .approve,
      false,
      "a check pinned to an app reads only the statuses its bot created",
    );
    assert.equal(
      decide({ checkRuns: pinned, statuses: [status("review", "success")] }).approve,
      true,
    );

    const asStatus = greenRuns.filter((run) => run.name !== "pr conventions");
    assert.equal(
      decide({ checkRuns: asStatus, statuses: [status("pr conventions", "success")] }).approve,
      true,
    );
    assert.equal(
      decide({ checkRuns: asStatus, statuses: [status("pr conventions", "pending")] }).approve,
      false,
    );
    const statusRetried = [
      status("pr conventions", "failure", 1),
      status("pr conventions", "success", 2),
    ];
    assert.equal(
      decide({ checkRuns: asStatus, statuses: statusRetried }).approve,
      true,
      "the newest status counts",
    );
  });

  /** @scenario "A PR that changes the review pipeline needs a human" */
  it("does not approve a PR that changes what the review job runs", () => {
    for (const path of [
      ".github/workflows/pr.yml",
      ".github/scripts/pr-auto-approve-decision.cjs",
      ".npmrc",
      "package.json",
      "go.work",
      ".claude/settings.json",
      "cmd/go.mod",
      "cmd/waitforchecks/main.go",
      "tools/waitforchecks/waitforchecks.go",
      "tools/ciguard/prreviewbot.go",
      "CLAUDE.md",
      "langwatch/src/AGENTS.md",
      "services/CLAUDE.md",
      "langwatch/.claude/settings.json",
      "pkg/go.mod",
      "services/go.sum",
      "langwatch/.mcp.json",
      "pkg/ciscan/scan.go",
    ]) {
      const decision = decide({ files: ["langwatch/src/a.ts", path] });
      assert.equal(decision.approve, false, path);
      assert.match(decision.reason, /review pipeline/);
    }
    assert.equal(
      decide({ files: ["langwatch/src/a.ts", "pkg/x/y.go", "docs/claude.md"] }).approve,
      true,
    );
    assert.equal(
      decide({ filesComplete: false }).approve,
      false,
      "a capped file list fails closed",
    );
  });

  /** @scenario "The decision is idempotent and ignores stale runs" */
  it("does not approve again, for firefighting, or for a stale run", () => {
    const approved: Review = { ...botReview(20, "APPROVED"), body: "Approved by automation" };
    assert.match(
      decide({ reviews: [botReview(10, "COMMENTED"), approved] }).reason,
      /already approved/,
    );
    assert.match(decide({ labels: ["firefighting"] }).reason, /firefighting/);
    assert.match(decide({ runHeadSha: OLD }).reason, /stale run/);
  });

  /** @scenario "A low-risk PR the review bot passed is approved without the flag" */
  it("approves a low-risk PR without needs-ack", () => {
    const decision = decide({ labels: ["low-risk-change"] });
    assert.equal(decision.approve, true);
    assert.equal(decision.needsAck, false);
  });
});

describe("required checks", () => {
  /** @scenario "Required checks come from rulesets and branch protection, each from its own app" */
  it("come from rulesets and branch protection, keeping the app each one is pinned to", () => {
    const rules = [
      { type: "pull_request", parameters: {} },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            { context: "ci-complete" },
            { context: "review", integration_id: ACTIONS_APP },
          ],
        },
      },
    ];
    const protection = {
      required_status_checks: {
        checks: [
          { context: "build", app_id: ACTIONS_APP },
          { context: "review", app_id: ACTIONS_APP },
          { context: "lint", app_id: null },
        ],
      },
    };
    assert.deepEqual(requiredChecksFrom(rules, protection), [
      { context: "ci-complete", appId: undefined },
      { context: "review", appId: ACTIONS_APP },
      { context: "build", appId: ACTIONS_APP },
      { context: "lint", appId: undefined },
    ]);
    assert.deepEqual(requiredChecksFrom([], undefined), []);
  });
});

describe("low-risk path allowlist", () => {
  /** @scenario "Low risk needs every path on the allowlist, whatever the model says" */
  it("allows only documentation, specs and images outside the review pipeline", () => {
    assert.equal(
      lowRiskPathsOnly([
        "docs/guide.mdx",
        "docs/images/logo.svg",
        "dev/docs/adr/x.md",
        "specs/ci/x.feature",
        "langwatch/README.md",
        "langwatch/public/logo.png",
      ]),
      true,
    );
    assert.equal(
      lowRiskPathsOnly(["langwatch/src/server/foo.md", "langwatch/src/server/foo.ts"]),
      false,
    );
    assert.equal(
      lowRiskPathsOnly(["langwatch/src/server/prompt.md"]),
      false,
      "not every .md is documentation",
    );
    assert.equal(
      lowRiskPathsOnly(["skills/tracing/SKILL.md"]),
      false,
      "a skill ships as agent instructions",
    );
    assert.equal(
      lowRiskPathsOnly(["langwatch/public/logo.svg"]),
      false,
      "an svg outside docs/ can carry script",
    );
    assert.equal(lowRiskPathsOnly(["README.md"]), false, "root-level files are review pipeline");
    assert.equal(lowRiskPathsOnly(["langwatch/CLAUDE.md"]), false);
    assert.equal(lowRiskPathsOnly([".claude/agents/x.md"]), false);
    assert.equal(lowRiskPathsOnly([]), false);
  });
});

describe("untrusted model text", () => {
  /** @scenario "Model text quoted into a comment cannot ping anyone or leave its quote" */
  it("stays on one line and breaks mentions", () => {
    const line = untrustedLine("Safe change.\n\n# Approved\n@langwatch/team please merge");
    assert.equal(line.includes("\n"), false);
    assert.equal(/@[a-z]/i.test(line), false);
    assert.equal(line, "Safe change. # Approved @\u200blangwatch/team please merge");
  });
});
