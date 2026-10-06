import type { EventEmitter } from "node:events";

import {
  type PresenceBroadcastFabric,
  PresenceApi,
  type PresenceApi as PresenceApiContract,
  type PresenceCursorSubscription,
  type PresenceCursorInput,
  type PresenceLeaveInput,
  type PresenceProjectInput,
  type PresenceProjectEvent,
  type PresenceSession,
  type PresenceTenantEmitter,
  type PresenceUpdateInput,
  type PresenceCursorEvent,
  type PresenceEvent,
  type ReadHint,
  type ReadHintsWatchInput,
} from "@langwatch/presence-contract";
import type { FeatureSetup } from "@langwatch/process";
import type { Cluster, Redis } from "ioredis";

import {
  buildPresenceSettingsPipeline,
  type PresenceSettingsPipeline,
} from "../eventing/presence-settings.pipeline.ts";
import type { PresenceRepositories } from "../repositories/presence.repositories.ts";
import { RedisBroadcastRepository } from "../repositories/redis/redis.broadcast.repository.ts";
import { BroadcastTenantRateLimiterService } from "../services/broadcast-tenant-rate-limiter.service.ts";
import { PresenceSettingsService } from "../services/presence-settings.service.ts";
import { PresenceStreamService } from "../services/presence-stream.service.ts";
import { PresenceService } from "../services/presence.service.ts";
import { ReadHintStreamService } from "../services/read-hint-stream.service.ts";

export interface PresenceBroadcast {
  publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor" | PresenceProjectEvent["channel"];
    rateLimited: boolean;
    /** The allowance a rate-limited publish spends; `delta` when unnamed. */
    tier?: PresenceProjectEvent["tier"];
  }): Promise<void>;
}

export interface PresenceDiagnostics {
  warn(message: string, context: Record<string, unknown>): void;
}

export interface PresenceEmitter {
  getTenantEmitter(tenantId: string): EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
}

/**
 * The closed members presence derives its broadcast fabric from: shared Redis (or null, degraded)
 * and a warning sink. `broadcast`/`emitters`/`diagnostics` are a test-only seam, absent in
 * production.
 */
type PresenceProcessMembers = Readonly<{
  redis: Redis | Cluster | null;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
  broadcast?: PresenceBroadcast;
  emitters?: PresenceEmitter;
  diagnostics?: PresenceDiagnostics;
}>;

type PresenceSetup = FeatureSetup<
  typeof PresenceModule.dependencies,
  PresenceProcessMembers,
  undefined,
  PresenceRepositories
>;

export class PresenceModule implements PresenceApiContract, PresenceBroadcastFabric {
  static readonly contract = PresenceApi;
  static readonly dependencies = {};
  static readonly reads = ["redis", "logger"] as const;

  readonly #presence: PresenceService;
  readonly #settings: PresenceSettingsService;
  readonly #stream: PresenceStreamService;
  readonly #readHints: ReadHintStreamService;
  /** The same fabric {@link PresenceBroadcastFabric} exposes to a peer. */
  readonly #emitters: PresenceEmitter;
  readonly #broadcast: PresenceBroadcast;

  private constructor({
    presence,
    settings,
    stream,
    readHints,
    emitters,
    broadcast,
  }: {
    presence: PresenceService;
    settings: PresenceSettingsService;
    stream: PresenceStreamService;
    readHints: ReadHintStreamService;
    emitters: PresenceEmitter;
    broadcast: PresenceBroadcast;
  }) {
    this.#presence = presence;
    this.#settings = settings;
    this.#stream = stream;
    this.#readHints = readHints;
    this.#emitters = emitters;
    this.#broadcast = broadcast;
  }

  static create({ repositories, members, resources }: PresenceSetup): PresenceModule {
    const needsDerivedFabric = !members.broadcast || !members.emitters;
    const derived = needsDerivedFabric
      ? RedisBroadcastRepository.create(members.redis, {
          sender: BroadcastTenantRateLimiterService.create(),
          subscriber: BroadcastTenantRateLimiterService.create(),
        })
      : undefined;
    if (derived) {
      resources.ownService({
        name: "presence-broadcast",
        start: () => derived.start(),
        stop: () => derived.close(),
      });
    }
    const broadcast: PresenceBroadcast = members.broadcast ?? derived!;
    const emitters: PresenceEmitter = members.emitters ?? derived!;
    const diagnostics: PresenceDiagnostics = members.diagnostics ?? {
      warn: (message, context) => members.logger.warn(context, message),
    };
    const settings = PresenceSettingsService.create({ repository: repositories.settings });
    const presence = PresenceService.create({
      repository: repositories.sessions,
      broadcast,
      settings,
      diagnostics,
    });

    return new PresenceModule({
      presence,
      settings,
      stream: PresenceStreamService.create({ presence, emitters }),
      readHints: ReadHintStreamService.create({ emitters }),
      emitters,
      broadcast,
    });
  }

  /** The pipeline whose peer subscribers fold the presence-setting facts. */
  settingsPipeline(): PresenceSettingsPipeline {
    return buildPresenceSettingsPipeline({ settings: this.#settings });
  }

  /** {@link PresenceBroadcastFabric}: the tenant's live-update signals. */
  getTenantEmitter(tenantId: string): PresenceTenantEmitter {
    return this.#emitters.getTenantEmitter(tenantId);
  }

  /** {@link PresenceBroadcastFabric}: releases the tenant emitter a subscription borrowed. */
  cleanupTenantEmitter(tenantId: string): void {
    this.#emitters.cleanupTenantEmitter(tenantId);
  }

  publishProjectEvent({ tier, ...input }: PresenceProjectEvent): Promise<void> {
    return this.#broadcast.publish(
      tier === undefined ? { ...input, rateLimited: false } : { ...input, rateLimited: true, tier },
    );
  }

  isEnabledForProject(input: PresenceProjectInput): Promise<boolean> {
    return this.#presence.isEnabledForProject(input);
  }

  async update(input: PresenceUpdateInput): Promise<void> {
    if (!(await this.#presence.isEnabledForProject({ projectId: input.projectId }))) return;

    await this.#presence.update(input);
  }

  async leave(input: PresenceLeaveInput): Promise<void> {
    if (!(await this.#presence.isEnabledForProject({ projectId: input.projectId }))) return;

    await this.#presence.leave(input);
  }

  list(input: PresenceProjectInput): Promise<PresenceSession[]> {
    return this.#presence.list(input);
  }

  async broadcastCursor(input: PresenceCursorInput): Promise<void> {
    if (!(await this.#presence.isEnabledForProject({ projectId: input.projectId }))) return;

    await this.#presence.broadcastCursor(input);
  }

  events(input: PresenceProjectInput & { signal?: AbortSignal }): AsyncGenerator<PresenceEvent> {
    return this.#stream.events(input);
  }

  cursors(
    input: PresenceCursorSubscription & { signal?: AbortSignal },
  ): AsyncGenerator<PresenceCursorEvent> {
    return this.#stream.cursors(input);
  }

  readHints({
    userId,
    organizationId,
    projectId,
    signal,
  }: ReadHintsWatchInput & { signal?: AbortSignal }): AsyncIterable<ReadHint> {
    const tenantIds = [userId, organizationId, ...(projectId === undefined ? [] : [projectId])];
    return this.#readHints.watch({ tenantIds, ...(signal === undefined ? {} : { signal }) });
  }
}
