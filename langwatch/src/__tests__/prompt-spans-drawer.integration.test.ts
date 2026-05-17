// Trace-UI consumer bindings for the prompt-spans parity work.
//
// These three scenarios test how the trace drawer + Evaluations-v3
// drill-down read the langwatch.prompt.* attributes emitted by
// nlpgo (per the .feature files under specs/nlp-go/prompt-spans-*).
// The emission contract is tested Go-side; this file binds the
// trace-UI consumption half.
//
// Stubs landed alongside the spec so the feature-parity binder
// (langwatch/scripts/check-feature-parity.ts) is satisfied. The Skip
// markers are replaced with real rendering assertions in this same
// PR once Lane A (sdk-go/prompts) + Lane B (engine emission) have
// produced real fixture traces to drive them.

import { describe, it } from "vitest";

const PENDING = "pending: nlpgo prompt-span emission + sdk-go/prompts wiring in this PR";

describe("prompt-spans trace-UI consumer parity", () => {
  /** @scenario 'trace drawer surfaces "Open in Prompts" with the exact handle and version' */
  it.skip("renders Open <handle>:<version> in the drawer menu from compile-span attrs", () => {
    // PENDING
    void PENDING;
  });

  /** @scenario 'clicking a row in experiment results opens the trace drawer with "Open in Prompts"' */
  it.skip("evaluations-v3 result-cell click opens drawer with the row's prompt reference", () => {
    void PENDING;
  });

  /** @scenario 'trace drawer surfaces the draft state on the "Open in Prompts" affordance' */
  it.skip("renders \"Open <handle>:<version> (unsaved edits)\" when langwatch.prompt.draft=true", () => {
    void PENDING;
  });
});
