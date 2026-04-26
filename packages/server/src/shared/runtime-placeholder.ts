// PLACEHOLDER — used by the CLI until julia ships services/runtime.ts.
// The CLI uses loadRuntime() to dynamically import services/runtime.ts and
// fall back to this placeholder when missing. Once the real runtime lands,
// loadRuntime() picks it up automatically — no edit needed here.

import type { RuntimeApi, RuntimeContext, RuntimeEvent, ServiceHandle } from "./runtime-contract.ts";

const notImplemented = (name: string) => async () => {
  throw new Error(`services/runtime.ts not yet implemented (${name}). julia is wiring this — ping in #langwatch-npx if blocked.`);
};

async function* emptyEvents(): AsyncIterable<RuntimeEvent> {
  // intentionally empty
}

export const placeholderRuntime: RuntimeApi = {
  scaffoldEnv: notImplemented("scaffoldEnv") as RuntimeApi["scaffoldEnv"],
  installServices: notImplemented("installServices") as RuntimeApi["installServices"],
  startAll: notImplemented("startAll") as RuntimeApi["startAll"],
  waitForHealth: notImplemented("waitForHealth") as RuntimeApi["waitForHealth"],
  stopAll: (async () => {}) as RuntimeApi["stopAll"],
  events: emptyEvents as RuntimeApi["events"],
};

export type { RuntimeApi, RuntimeContext, RuntimeEvent, ServiceHandle };
