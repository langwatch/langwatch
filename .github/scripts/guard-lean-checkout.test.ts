import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  GUARDED_WORKFLOWS,
  REQUIRED_EXCLUSIONS,
  checkoutSteps,
  isGateOnly,
  run,
  violations,
} from "./guard-lean-checkout.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

const lines = (text: string): string[] => text.split("\n");

const LEAN_STEP = `jobs:
  build:
    steps:
      - name: Checkout
        uses: actions/checkout@abc123 # v6
        with:
          sparse-checkout: |
            /*
            !/docs/media/
            !/docs/images/
            !/assets/
          sparse-checkout-cone-mode: false

      - name: Next
        run: echo hi
`;

const BARE_STEP = `jobs:
  build:
    steps:
      - uses: actions/checkout@abc123 # v6

      - name: Next
        run: echo hi
`;

const GATE_STEP = `jobs:
  changes:
    steps:
      - uses: actions/checkout@abc123 # v6
        with:
          sparse-checkout: .github
`;

const WHOLE_DOCS_STEP = LEAN_STEP.replace(
  "            !/docs/media/\n            !/docs/images/\n",
  "            !/docs/\n",
);

const CONE_MODE_STEP = LEAN_STEP.replace(
  "          sparse-checkout-cone-mode: false\n",
  "",
);

const UNANCHORED_STEP = LEAN_STEP.replace("!/assets/", "!assets/");

test("a lean step passes", () => {
  const steps = checkoutSteps("w.yml", lines(LEAN_STEP));
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.job, "build");
  assert.deepEqual(violations(steps), []);
});

/** @scenario "A new job added without the exclusion fails the check" */
test("a checkout with no sparse-checkout is reported by job name", () => {
  const problems = violations(checkoutSteps("w.yml", lines(BARE_STEP)));

  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /job "build"/);
  assert.match(problems[0] ?? "", /declares no sparse-checkout/);
});

/** @scenario "A gate job that reads no working tree takes only what it reads" */
test("a gate job narrowed to .github is exempt", () => {
  const steps = checkoutSteps("w.yml", lines(GATE_STEP));

  assert.equal(steps.length, 1);
  assert.equal(isGateOnly(steps[0]!), true);
  assert.deepEqual(violations(steps), []);
});

/** @scenario "Prose under docs/ is kept, because CI reads it" */
test("dropping docs/ wholesale is rejected", () => {
  const problems = violations(checkoutSteps("w.yml", lines(WHOLE_DOCS_STEP)));

  assert.ok(problems.some((p) => /drops docs\/ wholesale/.test(p)));
});

/** @scenario "Cone mode is refused because it would drop a new top-level directory" */
test("negation without cone mode disabled is rejected", () => {
  const problems = violations(checkoutSteps("w.yml", lines(CONE_MODE_STEP)));

  assert.ok(problems.some((p) => /cone mode does not honour negation/.test(p)));
});

/** @scenario "The exclusions are root-anchored" */
test("an unanchored exclusion is rejected", () => {
  const problems = violations(checkoutSteps("w.yml", lines(UNANCHORED_STEP)));

  assert.ok(problems.some((p) => /unanchored exclusion/.test(p)));
});

/** @scenario "A job that needs the working tree still leaves the media behind" */
test("the live workflows hold the invariant", () => {
  assert.deepEqual(run(REPO_ROOT), []);
});

test("the live workflows actually contain checkout steps to guard", () => {
  for (const workflow of GUARDED_WORKFLOWS) {
    const found = checkoutSteps(
      workflow,
      readFileSync(resolve(REPO_ROOT, workflow), "utf8").split("\n"),
    );
    assert.ok(found.length > 0, `${workflow} has no checkout steps to guard`);
  }
  assert.ok(REQUIRED_EXCLUSIONS.length > 0);
});
