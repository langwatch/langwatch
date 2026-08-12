/**
 * ADR-092 stage A4 — shadow mode. Behind AUTHZ_V2_SHADOW, every legacy
 * resolver fires an async engine comparison after answering. Mismatches are
 * logged with both verdicts and never affect the response; gate A is seven
 * quiet days of these logs.
 *
 * Known-divergence classification: the legacy API-key resolver applies no
 * lite-member cap while the legacy tRPC path does (ADR-092 Context #1/#10).
 * The engine implements the tRPC semantics, so mismatches on the api-key
 * paths for EXTERNAL owners are the pre-existing escalation surfacing, not
 * an engine bug — they are tagged `knownDivergence` so the mismatch
 * dashboard can partition them. Second family: the legacy key ceiling falls
 * back to TeamUser membership on ANY owner-binding denial, while the engine
 * (like the tRPC path) gates that fallback on having no chain bindings —
 * tagged `ceiling-legacy-fallback`.
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { collectGrants, resolveScopeRef } from "./collector";
import {
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
  decide,
  decideWithCeiling,
} from "./engine";

const logger = createLogger("langwatch:authz:shadow");

function shadowSampleRate(): number {
  const raw = process.env.AUTHZ_V2_SHADOW;
  if (!raw) return 0;
  if (raw === "1" || raw === "true") return 1;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function sampled(): boolean {
  const rate = shadowSampleRate();
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

function logOutcome({
  caller,
  legacyAllowed,
  engineAllowed,
  permission,
  scope,
  principal,
  denialReason,
  knownDivergence,
}: {
  caller: string;
  legacyAllowed: boolean;
  engineAllowed: boolean;
  permission: string;
  scope: AuthzScopeRef | null;
  principal: AuthzPrincipalRef;
  denialReason?: string;
  knownDivergence?: string;
}) {
  if (legacyAllowed === engineAllowed) return;
  logger.warn(
    {
      caller,
      permission,
      scopeType: scope?.type ?? "unresolved",
      scopeId: scope?.id,
      principalType: principal.type,
      legacyAllowed,
      engineAllowed,
      denialReason,
      knownDivergence,
    },
    "authz shadow mismatch",
  );
}

/**
 * Compare the engine against a legacy user-permission answer. Fire and
 * forget: never throws, never blocks, never changes the response.
 */
export function shadowUserPermissionCheck({
  prisma,
  userId,
  permission,
  legacyAllowed,
  projectId,
  teamId,
  organizationId,
  caller,
}: {
  prisma: PrismaClient;
  userId: string;
  permission: string;
  legacyAllowed: boolean;
  projectId?: string;
  teamId?: string;
  organizationId?: string;
  caller: string;
}): void {
  if (!sampled()) return;
  void (async () => {
    try {
      const scope = await resolveScopeRef({
        prisma,
        projectId,
        teamId,
        organizationId,
      });
      if (!scope) {
        logOutcome({
          caller,
          legacyAllowed,
          engineAllowed: false,
          permission,
          scope: null,
          principal: { type: "user", id: userId },
        });
        return;
      }
      const grants = await collectGrants({
        prisma,
        principal: { type: "user", id: userId },
        organizationId:
          scope.type === "organization" ? scope.id : scope.organizationId,
      });
      const decision = decide({
        grants,
        permission,
        scope,
        demoProjectId: process.env.DEMO_PROJECT_ID ?? undefined,
      });
      logOutcome({
        caller,
        legacyAllowed,
        engineAllowed: decision.allowed,
        permission,
        scope,
        principal: { type: "user", id: userId },
        denialReason: decision.denialReason,
        knownDivergence:
          grants.organizationRole === "EXTERNAL" && caller.startsWith("apiKey")
            ? "external-cap"
            : undefined,
      });
    } catch (error) {
      logger.debug({ error, caller }, "authz shadow comparison failed");
    }
  })();
}

/** The two documented divergence families (see the module header). */
function apiKeyKnownDivergence({
  ownerGrants,
  legacyAllowed,
  engineAllowed,
}: {
  ownerGrants: CollectedGrants | null;
  legacyAllowed: boolean;
  engineAllowed: boolean;
}): string | undefined {
  if (ownerGrants?.organizationRole === "EXTERNAL") return "external-cap";
  const hasLegacyRows = (ownerGrants?.legacyTeamMemberships.length ?? 0) > 0;
  if (legacyAllowed && !engineAllowed && hasLegacyRows) {
    return "ceiling-legacy-fallback";
  }
  return undefined;
}

/** Compare the engine's ceiling algebra against a legacy api-key answer. */
export function shadowApiKeyPermissionCheck({
  prisma,
  apiKeyId,
  ownerUserId,
  organizationId,
  permission,
  legacyAllowed,
  projectId,
  teamId,
  caller,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  ownerUserId: string | null;
  organizationId: string;
  permission: string;
  legacyAllowed: boolean;
  projectId?: string;
  teamId?: string;
  caller: string;
}): void {
  if (!sampled()) return;
  void (async () => {
    try {
      const scope = await resolveScopeRef({
        prisma,
        projectId,
        teamId,
        organizationId: projectId || teamId ? undefined : organizationId,
      });
      if (!scope) return;
      const [keyGrants, ownerGrants] = await Promise.all([
        collectGrants({
          prisma,
          principal: { type: "apiKey", id: apiKeyId },
          organizationId,
        }),
        ownerUserId
          ? collectGrants({
              prisma,
              principal: { type: "user", id: ownerUserId },
              organizationId,
            })
          : Promise.resolve(null),
      ]);
      const decision = decideWithCeiling({
        keyGrants,
        ownerGrants,
        permission,
        scope,
        demoProjectId: process.env.DEMO_PROJECT_ID ?? undefined,
      });
      logOutcome({
        caller,
        legacyAllowed,
        engineAllowed: decision.allowed,
        permission,
        scope,
        principal: { type: "apiKey", id: apiKeyId },
        denialReason: decision.denialReason,
        knownDivergence: apiKeyKnownDivergence({
          ownerGrants,
          legacyAllowed,
          engineAllowed: decision.allowed,
        }),
      });
    } catch (error) {
      logger.debug({ error, caller }, "authz shadow comparison failed");
    }
  })();
}
