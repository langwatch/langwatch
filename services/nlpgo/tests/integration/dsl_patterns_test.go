// Package integration_test — dsl_patterns_test.go is the home for
// regression tests derived from real-world Studio workflow shapes.
//
// Why this file exists:
//
//   The /go/* engine has unit-level coverage on every block executor and
//   provider-level coverage in the live e2es. What's NOT covered today is
//   structurally-realistic *combinations*: a 3-node linear chain with an
//   evaluator at the tail; a branching workflow with two signature
//   siblings that converge at an end node; a workflow that uses the
//   liquid-templated http block to fan out and a code block to reduce.
//
//   Customers in the wild have these shapes today and they need to keep
//   working bit-identical when their project flips to the Go path. This
//   file is where we mirror those shapes — with the explicit rule that
//   ZERO of the customer's actual content lands here.
//
// Anonymisation rules (load-bearing, do not relax):
//
//   - No customer name, no project name, no project id — anywhere.
//     Not in code. Not in comments. Not in fixture filenames. Not in
//     test names. Not in commit messages or PR descriptions referencing
//     this file.
//   - No copy of customer prompt text. We replicate the *shape* of the
//     prompt (system + user + variables, liquid usage, JSON-schema
//     output, etc.) but the actual words are ours.
//   - No replication of customer domain concepts. If the customer's
//     workflow is a "loan-application classifier", our equivalent
//     fixture is a "weather classifier" or "fictional Q&A". The
//     structural pattern is what matters; the surface should be
//     unambiguously generic.
//   - No second-order leaks. If a customer's evaluator slug encodes a
//     domain hint (e.g. "team-name/loan-grading-judge"), our analog
//     uses "team-x/topic-judge" or similar.
//
// How to add a new pattern:
//
//   1. From the redacted /tmp/nlpgo-prod-summary.md (NOT committed),
//      pick a structural pattern that isn't covered yet — e.g.
//      "evaluator with langevals/llm_judge slug + structured-output
//      signature upstream + liquid-templated system prompt".
//   2. Build the smallest fixture that exercises that exact shape. Use
//      generic concept names (math, weather, dialogue, fiction).
//   3. Run it through the existing setupEvaluatorStack harness so the
//      LangWatch endpoint is faked end-to-end, no real network calls.
//   4. Assert on the *engine outputs* (workflow result, node states,
//      cost propagation) — not on the prompt body. The prompt is ours
//      and shouldn't be load-bearing.
//
// Coverage map (filled in as patterns land):
//
//   pattern_001_linear_chain   — entry → signature → evaluator → end (placeholder)
//   pattern_002_branching      — TBD once data lands
//   pattern_003_liquid_in_sig  — TBD once data lands
//   pattern_004_chain_eval     — TBD once data lands
//
// See feedback memory entry "No customer names in public repo".

package integration_test
