import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { hasLangyAccess } from "./langy-access.adapter";

export type LangyIdentityToken =
  | {
      type: "legacyProjectKey";
      project: { id: string; team: { organizationId: string } };
    }
  | {
      type: "apiKey";
      userId: string | null;
      project: { id: string; team: { organizationId: string } };
    };

export type LangyIdentityDenialReason = "unowned" | "no-access";

export type LangyKeyIdentity =
  | { ok: true; userId: string }
  | { ok: false; reason: LangyIdentityDenialReason; message: string };

export async function resolveLangyKeyIdentity(input: {
  resolved: LangyIdentityToken;
  featureFlags: FeatureFlagService;
}): Promise<LangyKeyIdentity> {
  const userId = input.resolved.type === "apiKey" ? input.resolved.userId : null;
  if (!userId) {
    return {
      ok: false,
      reason: "unowned",
      message:
        "This API key is not owned by a user, so it cannot start a Langy conversation. Langy acts as a person, and the access decision is made per user. Use a key issued to a user with Langy access.",
    };
  }

  const allowed = await hasLangyAccess({
    user: { id: userId },
    projectId: input.resolved.project.id,
    organizationId: input.resolved.project.organizationId,
    featureFlags: input.featureFlags,
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
