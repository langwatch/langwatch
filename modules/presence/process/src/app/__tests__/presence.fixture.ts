import { EventEmitter } from "node:events";

/**
 * The presence graph as its tests need it: memory sessions, a fan-out that
 * records rather than publishes, and a settings fold seeded to the answer a test
 * asked for.
 */
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { vi } from "vitest";

import { MemoryPresenceSettingsRepository } from "../../repositories/memory/memory.presence-settings.repository.ts";
import { MemoryPresenceRepository } from "../../repositories/memory/memory.presence.repository.ts";
import type { PresenceBroadcastRepository } from "../../repositories/presence-broadcast.repository.ts";
import type { PresenceRepositories } from "../../repositories/presence.repositories.ts";
import { PresenceSettingsService } from "../../services/presence-settings.service.ts";
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

/** A settings fold where every project's creation and its own setting are recorded. */
export async function createPresenceTestSettings(enabled = true): Promise<PresenceSettingsService> {
  const repository = MemoryPresenceSettingsRepository.create();
  await seedPresenceSettings({ repository, enabled });
  return PresenceSettingsService.create({ repository });
}

const SEEDED_PROJECTS = ["project-1", "project-2", "project-a"] as const;

async function seedPresenceSettings({
  repository,
  enabled,
}: {
  repository: MemoryPresenceSettingsRepository;
  enabled: boolean;
}): Promise<void> {
  for (const projectId of SEEDED_PROJECTS) {
    await repository.recordProjectSetting({
      projectId,
      organizationId: "organization-1",
      presenceEnabled: enabled,
      occurredAt: 1,
    });
  }
}

/** Memory sessions beside a settings fold seeded as {@link createPresenceTestSettings} seeds it. */
export async function createPresenceTestRepositories(
  enabled = true,
): Promise<PresenceRepositories> {
  const settings = MemoryPresenceSettingsRepository.create();
  await seedPresenceSettings({ repository: settings, enabled });
  return {
    sessions: MemoryPresenceRepository.create(),
    settings,
    broadcast: presenceTestFabric({
      broadcast: new RecordingPresenceBroadcast(),
      emitters: new TestPresenceEmitters(),
    }),
  };
}

/** A broadcast repository composed from a recording publisher and a test emitter set. */
export function presenceTestFabric({
  broadcast,
  emitters,
}: {
  broadcast: PresenceBroadcast;
  emitters: PresenceEmitter;
}): PresenceBroadcastRepository {
  return {
    publish: (input) => broadcast.publish(input),
    getTenantEmitter: (tenantId) => emitters.getTenantEmitter(tenantId),
    cleanupTenantEmitter: (tenantId) => emitters.cleanupTenantEmitter(tenantId),
    start: async () => undefined,
    close: async () => undefined,
  };
}

export async function createPresenceTestApp(
  input: Readonly<{
    repositories?: PresenceRepositories;
    broadcast?: PresenceBroadcast;
    emitters?: PresenceEmitter;
    enabled?: boolean;
  }> = {},
): Promise<PresenceModule> {
  const base = input.repositories ?? (await createPresenceTestRepositories(input.enabled));
  return PresenceModule.create({
    repositories: {
      ...base,
      broadcast: presenceTestFabric({
        broadcast: input.broadcast ?? new RecordingPresenceBroadcast(),
        emitters: input.emitters ?? new TestPresenceEmitters(),
      }),
    },
    dependencies: {},
    config: void 0,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}
