/**
 * The chain both public Langy REST families run a caller through, after the
 * project door resolves the credential. ORDER IS THE CONTRACT: per-project
 * rollout (a dark 404), then the identity bridge, then the filing user.
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  LangyApiIdentityDeniedError,
  type LangyCredentialSession,
  type LangyKeyCaller,
  type LangyLocalCaller,
  type LangyRestCaller,
  type LangyRestCallerInput,
} from "@langwatch/langy-contract";
import {
  ProjectNotFoundError,
  type ProjectApi,
  type ProjectIdentity,
} from "@langwatch/project-contract";

import { LANGY_UI_ACTIONS_FLAG } from "../app/langy.members.ts";
import { LANGY_API_KEY_TURNS_FLAG } from "../rules/langy-rest-flags.rules.ts";
import {
  LangyActorSessionService,
  type LangyActorUserReader,
} from "./langy-actor-session.service.ts";
import { LangyKeyIdentityService } from "./langy-key-identity.service.ts";

/** What this chain reads that Langy does not own. */
export type LangyRestCallerMembers = Readonly<{
  /** This deployment's flag store, for the per-project rollout gate. */
  featureFlags: FeatureFlagApi;
  /** The user directory a key's owner is read from. */
  actors: LangyActorUserReader;
  /** The project's name, slug and organization, read once per call. */
  projects: Pick<ProjectApi, "findIdentity">;
}>;

const SURFACE_FLAGS = {
  turns: LANGY_API_KEY_TURNS_FLAG,
  ui_actions: LANGY_UI_ACTIONS_FLAG,
} as const;

export class LangyRestCallerService {
  static create(members: LangyRestCallerMembers): LangyRestCallerService {
    return new LangyRestCallerService(members);
  }

  private constructor(private readonly members: LangyRestCallerMembers) {}

  /**
   * Opens the surface's rollout flag, then bridges the key to its owner. A project the
   * rollout has not reached answers `dark`, exactly as an unmounted path does; every other
   * refusal throws.
   */
  async getCaller(input: LangyRestCallerInput): Promise<LangyRestCaller> {
    const project = await this.#project(input.projectId);
    const surfaceOpen = await this.members.featureFlags.isEnabled(SURFACE_FLAGS[input.surface], {
      kind: "project",
      projectId: project.id,
      organizationId: project.organizationId,
    });
    if (!surfaceOpen) return { dark: true };

    const userId = await this.getOwner({ actor: input.actor, project });
    return { dark: false, projectId: project.id, userId };
  }

  /** The owner of a local worker's key, with the project facts its links name. */
  async getLocalCaller(input: LangyKeyCaller): Promise<LangyLocalCaller> {
    const project = await this.#project(input.projectId);
    const userId = await this.getOwner({ actor: input.actor, project });
    return {
      userId,
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
    };
  }

  /** The person a turn is filed under, or the refusal that no such person exists. */
  async getActor(input: { userId: string }): Promise<LangyCredentialSession> {
    const actor = await LangyActorSessionService.create({ users: this.members.actors }).resolve(
      input,
    );
    if (!actor.ok) throw new LangyApiIdentityDeniedError("langy_api_actor_missing", actor.message);
    return actor.session;
  }

  /** A key no person owns (a legacy key too) arrives with no actor, and is refused as unowned. */
  private async getOwner(input: {
    actor: LangyKeyCaller["actor"];
    project: ProjectIdentity;
  }): Promise<string> {
    const identity = await LangyKeyIdentityService.create({
      featureFlags: this.members.featureFlags,
    }).resolve({
      resolved: {
        type: "apiKey",
        userId: input.actor?.type === "user" ? input.actor.id : null,
        project: input.project,
      },
    });
    if (!identity.ok) {
      throw new LangyApiIdentityDeniedError(
        identity.reason === "unowned" ? "langy_api_key_unowned" : "langy_api_key_no_langy_access",
        identity.message,
      );
    }
    return identity.userId;
  }

  async #project(projectId: string): Promise<ProjectIdentity> {
    const project = await this.members.projects.findIdentity(projectId);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }
}
