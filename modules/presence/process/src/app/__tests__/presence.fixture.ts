import { EventEmitter } from "node:events";

import { ResourceScope } from "@langwatch/kernel";
/**
 * The presence graph as its tests need it: memory sessions, a fan-out that
 * records rather than publishes, and peers that answer only what a test asked
 * for.
 */
import type { PresenceUser } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { vi } from "vitest";

import { MemoryPresenceRepositories } from "../../repositories/memory/memory.presence.repositories.ts";
import type { PresenceRepositories } from "../../repositories/presence.repositories.ts";
import type { PresenceBroadcast, PresenceDiagnostics, PresenceEmitter } from "../presence.app.ts";
import { PresenceApp } from "../presence.app.ts";

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

export function createPresenceTestUsers(profile?: Pick<PresenceUser, "name" | "image">): UserApi {
  return createApiFixture<UserApi>({
    findById: async ({ id }) =>
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
    broadcast?: PresenceBroadcast;
    emitters?: PresenceEmitter;
    diagnostics?: PresenceDiagnostics;
    projects?: ProjectApi;
    users?: UserApi;
  }> = {},
): PresenceApp {
  return PresenceApp.create({
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
      users: input.users ?? createPresenceTestUsers({ name: "Ada", image: null }),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
