import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasSafeGate,
  jobBlocks,
  jobIfExpression,
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

  it("extracts commented jobs keys", () => {
    const [job] = jobBlocks([
      "jobs: # workflow jobs",
      "  'build': # comment after job key",
      "    runs-on: ubuntu-latest",
    ]);

    assert.ok(job);
    assert.equal(job.name, "build");
  });
});
