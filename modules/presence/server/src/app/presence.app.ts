import {
  PresenceApi,
  type PresenceApi as PresenceApiContract,
  type PresenceCursorSubscription,
  type PresenceCursorTickInput,
  type PresenceHeartbeatInput,
  type PresenceLeaveInput,
  type PresenceProjectInput,
  type PresenceSession,
  type PresenceUser,
} from "@langwatch/presence-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import type {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  PresenceEmitterPort,
} from "../ports/presence.port.ts";
import type { PresenceRepositories } from "../repositories/presence.repositories.ts";
import { PresenceService } from "../services/presence.service.ts";
import { PresenceStreamService } from "../services/presence-stream.service.ts";

/** The tenant fan-out the process owns, and the sink its warnings go to. */
export type PresenceInfrastructure = Readonly<{
  broadcast: PresenceBroadcastPort;
  emitters: PresenceEmitterPort;
  diagnostics: PresenceDiagnosticsPort;
}>;

type PresenceSetup = FeatureSetup<
  typeof PresenceApp.dependencies,
  PresenceInfrastructure,
  undefined,
  PresenceRepositories
>;

export class PresenceApp implements PresenceApiContract {
  static readonly contract = PresenceApi;
  static readonly dependencies = { projects: ProjectApi, users: UserApi };

  readonly #presence: PresenceService;
  readonly #stream: PresenceStreamService;
  readonly #users: UserApi;

  private constructor(presence: PresenceService, stream: PresenceStreamService, users: UserApi) {
    this.#presence = presence;
    this.#stream = stream;
    this.#users = users;
  }

  static create({ repositories, infrastructure, dependencies }: PresenceSetup): PresenceApp {
    const presence = PresenceService.create({
      repository: repositories.sessions,
      broadcast: infrastructure.broadcast,
      projects: dependencies.projects,
      diagnostics: infrastructure.diagnostics,
    });

    return new PresenceApp(
      presence,
      PresenceStreamService.create({ presence, emitters: infrastructure.emitters }),
      dependencies.users,
    );
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
    const profile = await this.#users.tryFindById({ id: userId });

    return { id: userId, name: profile?.name ?? null, image: profile?.image ?? null };
  }
}
