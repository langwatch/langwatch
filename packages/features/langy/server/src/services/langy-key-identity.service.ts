import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { LangyAccessService } from "./langy-access.service";

/**
 * The two fields this gate reads off a resolved credential.
 *
 * Structural rather than `ResolvedApiKeyToken` itself, so the gate names what
 * it uses and nothing more. The project half tracks `ProjectIdentity`: since
 * a credential carries the identity instead of the project row with its team
 * (`@langwatch/project-contract`), the organization is a field on the project
 * and not a nested team.
 */
export type LangyIdentityToken =
  | {
      type: "legacyProjectKey";
      project: { id: string; organizationId: string };
    }
  | {
      type: "apiKey";
      userId: string | null;
      project: { id: string; organizationId: string };
    };

export type LangyIdentityDenialReason = "unowned" | "no-access";

export type LangyKeyIdentity =
  | { ok: true; userId: string }
  | { ok: false; reason: LangyIdentityDenialReason; message: string };

/** Bridges a resolved credential to the user a Langy turn runs as. */
export class LangyKeyIdentityService {
  static create(options: { featureFlags: FeatureFlagService }): LangyKeyIdentityService {
    return new LangyKeyIdentityService({
      access: LangyAccessService.create({ featureFlags: options.featureFlags }),
    });
  }

  private readonly access: LangyAccessService;

  private constructor(options: { access: LangyAccessService }) {
    this.access = options.access;
  }

  async resolve(input: { resolved: LangyIdentityToken }): Promise<LangyKeyIdentity> {
    const userId = input.resolved.type === "apiKey" ? input.resolved.userId : null;
    if (!userId) {
      return {
        ok: false,
        reason: "unowned",
        message:
          "This API key is not owned by a user, so it cannot start a Langy conversation. Langy acts as a person, and the access decision is made per user. Use a key issued to a user with Langy access.",
      };
    }

    const allowed = await this.access.hasAccess({
      user: { id: userId },
      projectId: input.resolved.project.id,
      organizationId: input.resolved.project.organizationId,
    });
    if (!allowed) {
      return {
        ok: false,
        reason: "no-access",
        message:
          "The user this API key belongs to does not have access to Langy. Access is granted per user, so a key keeps working for everything else while Langy stays refused.",
      };
    }

    return { ok: true, userId };
  }
}
