/**
 * The chain both public Langy REST families run a caller through once the
 * process's project door has already resolved the credential and enforced the
 * key's ceiling. ORDER IS THE CONTRACT, and it is the same on the turn surface
 * and the UI-action surface: per-project rollout (a dark 404), then the
 * identity bridge to the owning user, then the person a turn is filed under.
 */
import type { FeatureFlagApi, FeatureFlagKey } from "@langwatch/feature-flag-contract";
import { LangyApiIdentityDeniedError } from "@langwatch/langy-contract";

import {
  LangyActorSessionService,
  type LangyActorResolution,
  type LangyActorUserReader,
} from "./langy-actor-session.service.ts";
import {
  LangyKeyIdentityService,
  type LangyIdentityToken,
} from "./langy-key-identity.service.ts";

/** A caller who got through, or the dark surface that answers nothing. */
export type LangyRestCaller =
  | Readonly<{ dark: true }>
  | Readonly<{ dark: false; projectId: string; userId: string }>;

/** What this chain reads that Langy does not own. */
export type LangyRestCallerMembers = Readonly<{
  /** This deployment's flag store, for the per-project rollout gate. */
  featureFlags: FeatureFlagApi;
  /** The user directory a key's owner is read from. */
  actors: LangyActorUserReader;
}>;

export class LangyRestCallerService {
  static create(members: LangyRestCallerMembers): LangyRestCallerService {
    return new LangyRestCallerService(members);
  }

  private constructor(private readonly members: LangyRestCallerMembers) {}

  /**
   * Opens the rollout flag and bridges the door's credential to the owning
   * user. Throws on every refusal EXCEPT the dark surface, which is not a
   * refusal at all: a project the rollout has not reached must answer exactly
   * as an unmounted path does.
   */
  async resolve(input: {
    /** The credential the process's project door already resolved. */
    resolved: LangyIdentityToken;
    /** The rollout flag this surface is gated on. */
    flag: FeatureFlagKey;
  }): Promise<LangyRestCaller> {
    const { project } = input.resolved;
    const surfaceOpen = await this.members.featureFlags.isEnabled(input.flag, {
      kind: "project",
      projectId: project.id,
      organizationId: project.organizationId,
    });
    if (!surfaceOpen) return { dark: true };

    const identity = await LangyKeyIdentityService.create({
      featureFlags: this.members.featureFlags,
    }).resolve({ resolved: input.resolved });
    if (!identity.ok) {
      throw new LangyApiIdentityDeniedError(
        identity.reason === "unowned" ? "langy_api_key_unowned" : "langy_api_key_no_langy_access",
        identity.message,
      );
    }

    return { dark: false, projectId: project.id, userId: identity.userId };
  }

  /** The person a turn is filed under, or the refusal that no such person exists. */
  async resolveActor(input: { userId: string }): Promise<LangyActorResolution> {
    return LangyActorSessionService.create({ users: this.members.actors }).resolve(input);
  }
}
