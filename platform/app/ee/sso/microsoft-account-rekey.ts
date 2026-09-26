// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Moves an Azure AD account stored under its pre-3.17 key onto the key
 * better-auth 1.7 looks it up by, the first time its owner signs in.
 *
 * Before 3.17 a Microsoft account was stored as `(microsoft, sub)`: both
 * NextAuth's azure-ad provider and better-auth 1.6 used the token's `sub`,
 * and the `account_issuer` migration gave those rows the synthetic issuer
 * `local:oauth:microsoft`. better-auth 1.7 finds the same account by
 * `(profile.iss, profile.oid)` instead, so neither half of the stored key
 * matches and the sign-in falls through to account linking, which either
 * refuses the user or writes a second row.
 *
 * Neither `oid` nor the tenant's `iss` can be derived offline from what the
 * row holds (`sub` is a per-application hash), but the id token of the sign-in
 * carries all three. So the re-key happens here, from that token, before
 * better-auth runs its lookup: the row whose stored subject is this token's
 * `sub` is the row better-auth 1.6 would have found for it, and it is moved to
 * `(iss, oid)`. Works for single-tenant and multi-tenant (`common`,
 * `organizations`) deployments alike, with no operator step.
 */

import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

const logger = createLogger("langwatch:sso:microsoft-account-rekey");

export const MICROSOFT_PROVIDER_ID = "microsoft";
export const LEGACY_MICROSOFT_ISSUER = issuerForProviderId(
  MICROSOFT_PROVIDER_ID,
);

export interface MicrosoftAccountKeyMove {
  /** The subject a pre-3.17 row was stored under. */
  legacySubject: string;
  /** The issuer better-auth 1.7 compares: the token's own `iss`. */
  issuer: string;
  /** The subject better-auth 1.7 compares: the token's `oid`. */
  accountId: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * The key move one Microsoft id token asks for, or null when the token cannot
 * name both keys or when they are the same key.
 */
export function microsoftAccountKeyMove(
  profile: Record<string, unknown>,
): MicrosoftAccountKeyMove | null {
  const { sub, oid, iss } = profile;
  if (!nonEmpty(sub) || !nonEmpty(oid) || !nonEmpty(iss)) return null;
  if (!iss.startsWith("https://")) return null;
  if (sub === oid) return null;
  return { legacySubject: sub, issuer: iss, accountId: oid };
}

export type MicrosoftAccountRekeyResult = "rekeyed" | "unchanged";

/**
 * Applies the move to the `Account` row still on the legacy key, and to the
 * `Identifier` rows seeded from it. A row already on the 1.7 key, or a
 * subject no legacy row holds, leaves everything as it is.
 */
export async function rekeyLegacyMicrosoftAccount({
  prisma,
  move,
}: {
  prisma: Pick<PrismaClient, "$transaction">;
  move: MicrosoftAccountKeyMove;
}): Promise<MicrosoftAccountRekeyResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const alreadyKeyed = await tx.account.findFirst({
        where: {
          provider: MICROSOFT_PROVIDER_ID,
          providerAccountId: move.accountId,
        },
        select: { id: true },
      });
      if (alreadyKeyed) return "unchanged";

      const legacy = await tx.account.findFirst({
        where: {
          provider: MICROSOFT_PROVIDER_ID,
          providerAccountId: move.legacySubject,
          issuer: LEGACY_MICROSOFT_ISSUER,
        },
        select: { id: true },
      });
      if (!legacy) return "unchanged";

      await tx.account.update({
        where: { id: legacy.id },
        data: { issuer: move.issuer, providerAccountId: move.accountId },
      });
      await tx.identifier.updateMany({
        where: { accountId: legacy.id },
        data: { issuer: move.issuer, providerAccountId: move.accountId },
      });
      return "rekeyed";
    });
  } catch (error) {
    // A concurrent sign-in of the same user moved the row first.
    if ((error as { code?: unknown } | null)?.code === "P2002") {
      return "unchanged";
    }
    throw error;
  }
}

/**
 * The sign-in callback `buildSocialProviders` takes as `onMicrosoftProfile`.
 * Never throws: when the re-key fails the sign-in carries on to better-auth's
 * own lookup, exactly as it would without this step.
 */
export function microsoftProfileRekey({
  prisma,
}: {
  prisma: Pick<PrismaClient, "$transaction">;
}): (profile: Record<string, unknown>) => Promise<void> {
  return async (profile) => {
    const move = microsoftAccountKeyMove(profile);
    if (!move) return;
    try {
      const result = await rekeyLegacyMicrosoftAccount({ prisma, move });
      if (result === "rekeyed") {
        logger.info(
          { issuer: move.issuer },
          "moved a pre-3.17 Microsoft account onto its better-auth 1.7 key",
        );
      }
    } catch (error) {
      logger.warn(
        { error },
        "could not move a pre-3.17 Microsoft account onto its better-auth 1.7 key",
      );
    }
  };
}
