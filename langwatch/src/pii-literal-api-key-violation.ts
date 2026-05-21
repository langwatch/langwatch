// Smoke-test for issue #3754 — DO NOT MERGE.
// Expect semgrep `pii-literal-api-key` to flag both literals below.
// (Real-world keys are blocked by GitHub Push Protection — these are
// SHAPE-MATCHING but provably-fake placeholders so the regex fires
// without tripping secret scanners.)

// `sk_live_FAKE_FAKE_FAKE_FAKE_FAKE_FAKE_FAKE_FAKE` — semgrep regex sees the
// `sk_live_` prefix + 16+ chars of [A-Za-z0-9_-], should flag.
export const LEAKED_KEY_STRIPE = "sk_live_FAKE_FAKE_FAKE_FAKE_FAKE_FAKE";
export const LEAKED_KEY_OPENAI = "sk-proj-FAKE_FAKE_FAKE_FAKE_FAKE_FAKE";
export const LEAKED_KEY_ANTHROPIC = "sk-ant-FAKE_FAKE_FAKE_FAKE_FAKE_FAKE";
export const LEAKED_KEY_XAI = "xai-FAKE_FAKE_FAKE_FAKE_FAKE_FAKE";
