import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasSafeGate,
  hasSensitivePermissions,
  jobBlocks,
  jobIfExpression,
  usesNonGithubTokenSecret,
  usesPullRequestTarget,
} from "./guard-pull-request-target.ts";

const unsafeCheckoutJob = (ifLines: string[]): string[] => [
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  ...ifLines,
  "    steps:",
  "      - uses: actions/checkout@v6",
  "        with:",
  "          ref: ${{ github.event.pull_request.head.sha }}",
];

describe("pull_request_target workflow guard", () => {
  it("detects pull_request_target trigger forms with values", () => {
    assert.equal(usesPullRequestTarget(["  pull_request_target: # labeled"]), true);
    assert.equal(
      usesPullRequestTarget(["on: { pull_request_target: { types: [labeled] } }"]),
      true,
    );
  });

  it("reads safe gates only from a job-level if field", () => {
    const [commentSpoofedJob] = jobBlocks(
      unsafeCheckoutJob([
        "    # github.event.label.name == 'approved-ci'",
        "    if: always()",
      ]),
    );
    assert.ok(commentSpoofedJob);
    assert.equal(hasSafeGate(commentSpoofedJob), false);

    const [gatedJob] = jobBlocks(
      unsafeCheckoutJob([
        "    if: >",
        "      github.event_name != 'pull_request_target'",
        "      || github.event.label.name == 'approved-ci'",
      ]),
    );
    assert.ok(gatedJob);
    assert.equal(
      jobIfExpression(gatedJob),
      "github.event_name != 'pull_request_target'\n|| github.event.label.name == 'approved-ci'",
    );
    assert.equal(hasSafeGate(gatedJob), true);
  });

  it("extracts commented and wider-indented jobs keys", () => {
    const [commentedJob] = jobBlocks([
      "jobs: # workflow jobs",
      "  'build': # comment after job key",
      "    runs-on: ubuntu-latest",
    ]);
    const [indentedJob] = jobBlocks([
      "jobs:",
      "    build: # indented job key",
      "      if: github.event.label.name == 'approved-ci'",
      "      runs-on: ubuntu-latest",
    ]);

    assert.ok(commentedJob);
    assert.equal(commentedJob.name, "build");
    assert.ok(indentedJob);
    assert.equal(indentedJob.name, "build");
    assert.equal(hasSafeGate(indentedJob), true);
  });

  it("detects privileged pull_request_target risk signals", () => {
    assert.equal(hasSensitivePermissions(["permissions:", "  contents: write"].join("\n")), true);
    assert.equal(hasSensitivePermissions("permissions: write-all"), true);
    assert.equal(hasSensitivePermissions("# contents: write"), false);

    assert.equal(usesNonGithubTokenSecret("token: ${{ secrets.RELEASE_PLEASE_TOKEN }}"), true);
    assert.equal(usesNonGithubTokenSecret("token: ${{ secrets.GITHUB_TOKEN }}"), false);
  });
});
