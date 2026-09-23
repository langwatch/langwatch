import type { EventEmitter } from "node:events";

import type { FeatureSetup } from "@langwatch/kernel";
import type { PresenceBroadcastFabric } from "@langwatch/presence-contract";
import {
  PresenceApi,
  type PresenceApi as PresenceApiContract,
  type PresenceCursorSubscription,
  type PresenceCursorTickInput,
  type PresenceHeartbeatInput,
  type PresenceLeaveInput,
  type PresenceProjectInput,
  type PresenceProjectEvent,
  type PresenceSession,
  type PresenceTenantEmitter,
  type PresenceUser,
} from "@langwatch/presence-contract";
import { reads } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { UserApi } from "@langwatch/user-contract";
import type { Cluster, Redis } from "ioredis";

import type { PresenceRepositories } from "../repositories/presence.repositories.ts";
import { RedisBroadcastRepository } from "../repositories/redis/redis.broadcast.repository.ts";
import { PresenceStreamService } from "../services/presence-stream.service.ts";
import { PresenceService } from "../services/presence.service.ts";

export interface PresenceBroadcast {
  publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor" | "export_progress";
    rateLimited: boolean;
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
 * The closed members presence derives its own broadcast fabric from: the
 * process's shared Redis connection (or null, degraded), and where a
 * best-effort broadcast warning is reported. `broadcast`/`emitters`/
 * `diagnostics` are a test-only fabric seam; production composition leaves
 * them absent and gets the derived Redis-backed fabric.
 */
type PresenceProcessMembers = Readonly<{
  redis: Redis | Cluster | null;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
  broadcast?: PresenceBroadcast;
  emitters?: PresenceEmitter;
  diagnostics?: PresenceDiagnostics;
}>;

type PresenceSetup = FeatureSetup<
  typeof PresenceApp.dependencies,
  PresenceProcessMembers,
  undefined,
  PresenceRepositories
>;

export class PresenceApp implements PresenceApiContract, PresenceBroadcastFabric {
  static readonly contract = PresenceApi;
  static readonly dependencies = { projects: ProjectApi, users: UserApi };
  static readonly reads = reads("redis", "logger");

  readonly #presence: PresenceService;
  readonly #stream: PresenceStreamService;
  readonly #users: UserApi;
  /** The same fabric {@link PresenceBroadcastFabric} exposes to a peer. */
  readonly #emitters: PresenceEmitter;
  readonly #broadcast: PresenceBroadcast;

  private constructor(
    presence: PresenceService,
    stream: PresenceStreamService,
    users: UserApi,
    emitters: PresenceEmitter,
    broadcast: PresenceBroadcast,
  ) {
    this.#presence = presence;
    this.#stream = stream;
    this.#users = users;
    this.#emitters = emitters;
    this.#broadcast = broadcast;
  }

  static create({ repositories, members, dependencies, resources }: PresenceSetup): PresenceApp {
    const needsDerivedFabric = !members.broadcast || !members.emitters;
    const derived = needsDerivedFabric ? RedisBroadcastRepository.create(members.redis) : undefined;
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
    const presence = PresenceService.create({
      repository: repositories.sessions,
      broadcast,
      projects: dependencies.projects,
      diagnostics,
    });

    return new PresenceApp(
      presence,
      PresenceStreamService.create({ presence, emitters }),
      dependencies.users,
      emitters,
      broadcast,
    );
  }

  /** {@link PresenceBroadcastFabric}: the tenant's live-update signals. */
  getTenantEmitter(tenantId: string): PresenceTenantEmitter {
    return this.#emitters.getTenantEmitter(tenantId);
  }

  /** {@link PresenceBroadcastFabric}: releases the tenant emitter a subscription borrowed. */
  cleanupTenantEmitter(tenantId: string): void {
    this.#emitters.cleanupTenantEmitter(tenantId);
  }

  publishProjectEvent(input: PresenceProjectEvent): Promise<void> {
    return this.#broadcast.publish({ ...input, rateLimited: false });
  }

  isEnabledForProject(input: PresenceProjectInput): Promise<boolean> {
    return this.#presence.isEnabledForProject(input);
  }

  async update(input: PresenceHeartbeatInput): Promise<void> {
    if (!(await this.#presence.isEnabledForProject({ projectId: input.projectId }))) return;

    await this.#presence.update({
      projectId: input.projectId,
      sessionId: input.sessionId,
      user: await this.#presenting(input.userId),
      location: input.location,
    });
  }

  async leave(input: PresenceLeaveInput): Promise<void> {
    if (!(await this.#presence.isEnabledForProject({ projectId: input.projectId }))) return;

    await this.#presence.leave(input);
  }

  list(input: PresenceProjectInput): Promise<PresenceSession[]> {
    return this.#presence.list(input);
  }

  async broadcastCursor(input: PresenceCursorTickInput): Promise<void> {
    if (!(await this.#presence.isEnabledForProject({ projectId: input.projectId }))) return;

    await this.#presence.broadcastCursor({
      projectId: input.projectId,
      sessionId: input.sessionId,
      user: await this.#presenting(input.userId),
      payload: input.payload,
    });
  }

  events(input: PresenceProjectInput & { signal?: AbortSignal }) {
    return this.#stream.events(input);
  }

  cursors(input: PresenceCursorSubscription & { signal?: AbortSignal }) {
    return this.#stream.cursors(input);
  }

  /**
   * The person peers see, read from the directory by the id the boundary
   * authenticated — never from the payload, which would let one member publish
   * a session under another member's name and avatar.
   */
  async #presenting(userId: string): Promise<PresenceUser> {
    const profile = await this.#users.findById({ id: userId });

    return { id: userId, name: profile?.name ?? null, image: profile?.image ?? null };
  }
}
