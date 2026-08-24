import "@testing-library/jest-dom/vitest";
import { initializeEnvironmentConfig } from "./src/env.mjs";
import {
  createPublicAppConfigMetaTag,
  PUBLIC_APP_CONFIG_META_NAME,
} from "./src/runtime/public-config";

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
initializeEnvironmentConfig(process.env);

if (!document.querySelector(`meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`)) {
  document.head.insertAdjacentHTML(
    "beforeend",
    createPublicAppConfigMetaTag({
      appBaseUrl: "http://localhost:5560",
      gatewayBaseUrl: "http://localhost:5560",
      deployment: "self-hosted",
      mode: "test",
      telemetry: { browserTracing: false, sampleRatio: 1 },
      capabilities: { email: false, nlp: false, langevals: false },
    }),
  );
}
