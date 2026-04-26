// PLACEHOLDER — used by the CLI until julia ships services/runtime.ts.
// The CLI uses loadRuntime() to dynamically import services/runtime.ts and
// fall back to this placeholder when missing. Once the real runtime lands,
// loadRuntime() picks it up automatically — no edit needed here.

import type { RuntimeApi, RuntimeContext, ServiceHandle } from "./runtime-contract.ts";

const notImplemented = (name: string) => () => {
  throw new Error(`services/runtime.ts not yet implemented (${name}). julia is wiring this — ping in #langwatch-npx if blocked.`);
};

export const placeholderRuntime: RuntimeApi = {
  installServices: notImplemented("installServices") as RuntimeApi["installServices"],
  scaffoldEnv: notImplemented("scaffoldEnv") as RuntimeApi["scaffoldEnv"],
  startAll: notImplemented("startAll") as RuntimeApi["startAll"],
  waitForHealth: notImplemented("waitForHealth") as RuntimeApi["waitForHealth"],
  stopAll: (async () => {}) as RuntimeApi["stopAll"],
};

export type { RuntimeApi, RuntimeContext, ServiceHandle };
