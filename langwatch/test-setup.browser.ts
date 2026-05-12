import "@testing-library/jest-dom/vitest";

// Browser bundles transitively touch `process.env` through `env-create.mjs`
// (and other Node-shaped modules). Vitest's browser provider doesn't expose
// `process` by default, so importing anything that walks that chain throws
// `ReferenceError: process is not defined` at evaluation time. A minimal stub
// keeps the env loader on its build-time-optional path without leaking real
// secrets into the test bundle.
if (typeof globalThis.process === "undefined") {
  // @ts-expect-error - shimming Node's process for browser-mode tests
  globalThis.process = {
    env: {
      NODE_ENV: "test",
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
    },
  };
}
