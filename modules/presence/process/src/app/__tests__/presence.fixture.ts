import { EventEmitter } from "node:events";

/**
 * The presence graph as its tests need it: memory sessions, a fan-out that
 * records rather than publishes, and peers that answer only what a test asked
 * for.
 */
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import { MemoryPresenceRepositories } from "../../repositories/memory/memory.presence.repositories.ts";
import type { PresenceRepositories } from "../../repositories/presence.repositories.ts";
import type { PresenceBroadcast, PresenceDiagnostics, PresenceEmitter } from "../presence.app.ts";
import { PresenceModule } from "../presence.app.ts";

type PresencePublishInput = Parameters<PresenceBroadcast["publish"]>[0];

export class RecordingPresenceBroadcast implements PresenceBroadcast {
  readonly publish = vi.fn<(input: PresencePublishInput) => Promise<void>>(async () => undefined);
}

export class RecordingPresenceDiagnostics implements PresenceDiagnostics {
  readonly warn = vi.fn();
}

export class TestPresenceEmitters implements PresenceEmitter {
  readonly emitter = new EventEmitter();
  readonly getTenantEmitter = vi.fn(() => this.emitter);
  readonly cleanupTenantEmitter = vi.fn();
}

export function createPresenceTestProjects(enabled = true): ProjectApi {
  return createApiFixture<ProjectApi>({ isPresenceEnabled: async () => enabled });
}

export function createPresenceTestApp(
  input: Readonly<{
    repositories?: PresenceRepositories;
    broadcast?: PresenceBroadcast;
    emitters?: PresenceEmitter;
    diagnostics?: PresenceDiagnostics;
    projects?: ProjectApi;
  }> = {},
): PresenceModule {
  return PresenceModule.create({
    repositories: input.repositories ?? MemoryPresenceRepositories.create(),
    members: {
      redis: null,
      logger: { warn: () => undefined },
      broadcast: input.broadcast ?? new RecordingPresenceBroadcast(),
      emitters: input.emitters ?? new TestPresenceEmitters(),
      diagnostics: input.diagnostics ?? new RecordingPresenceDiagnostics(),
    },
    dependencies: {
      projects: input.projects ?? createPresenceTestProjects(),
    },
    config: void 0,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}
