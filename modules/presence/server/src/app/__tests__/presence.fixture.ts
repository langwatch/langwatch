/**
 * The presence graph as its tests need it: memory sessions, a fan-out that
 * records rather than publishes, and peers that answer only what a test asked
 * for.
 */
import type { PresenceUser } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  PresenceEmitterPort,
} from "../../ports/presence.port.ts";
import type { PresenceRepositories } from "../../repositories/presence.repositories.ts";
import { MemoryPresenceRepositories } from "../../repositories/memory/memory.presence.repositories.ts";
import { PresenceApp } from "../presence.app.ts";

type PresencePublishInput = Parameters<PresenceBroadcastPort["publish"]>[0];

export class RecordingPresenceBroadcast extends PresenceBroadcastPort {
  readonly publish = vi.fn<(input: PresencePublishInput) => Promise<void>>(async () => undefined);
}

export class RecordingPresenceDiagnostics extends PresenceDiagnosticsPort {
  readonly warn = vi.fn();
}

export class TestPresenceEmitters extends PresenceEmitterPort {
  readonly emitter = new EventEmitter();
  readonly getTenantEmitter = vi.fn(() => this.emitter);
  readonly cleanupTenantEmitter = vi.fn();
}

export function createPresenceTestProjects(enabled = true): ProjectApi {
  return createApiFixture<ProjectApi>({ isPresenceEnabled: async () => enabled });
}

export function createPresenceTestUsers(profile?: Pick<PresenceUser, "name" | "image">): UserApi {
  return createApiFixture<UserApi>({
    tryFindById: async ({ id }) =>
      profile === undefined
        ? null
        : {
            id,
            name: profile.name,
            email: null,
            emailVerified: true,
            image: profile.image,
            pendingSsoSetup: false,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            lastLoginAt: null,
            deactivatedAt: null,
          },
  });
}

export function createPresenceTestApp(
  input: Readonly<{
    repositories?: PresenceRepositories;
    broadcast?: PresenceBroadcastPort;
    emitters?: PresenceEmitterPort;
    diagnostics?: PresenceDiagnosticsPort;
    projects?: ProjectApi;
    users?: UserApi;
  }> = {},
): PresenceApp {
  return PresenceApp.create({
    repositories: input.repositories ?? MemoryPresenceRepositories.create(),
    infrastructure: {
      broadcast: input.broadcast ?? new RecordingPresenceBroadcast(),
      emitters: input.emitters ?? new TestPresenceEmitters(),
      diagnostics: input.diagnostics ?? new RecordingPresenceDiagnostics(),
    },
    dependencies: {
      projects: input.projects ?? createPresenceTestProjects(),
      users: input.users ?? createPresenceTestUsers({ name: "Ada", image: null }),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
