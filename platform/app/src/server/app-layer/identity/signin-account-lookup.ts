import {
  type AccountSignInMethods,
  isLiveIdentifierState,
} from "@langwatch/identity";
import type {
  IdentityHeadsRepository,
  IdentityUserGate,
  SignInAccountLookupPort,
} from "@langwatch/identity-server";
import { auth0BridgeMethodForSubject } from "~/utils/auth0-bridge";

/** The non-secret legacy answer used while identifier backfill is pending. */
export interface LegacySignInAccount {
  userId: string;
  methods: AccountSignInMethods;
  /** The Auth0 subjects among this user's `Account` rows, verbatim, so the
   *  connection bridge can route each to its own branded button. Empty where
   *  the user holds none. An opaque identifier, never a secret. */
  auth0Subjects: readonly string[];
}

export interface LegacySignInAccountDirectory {
  findLegacySignInAccount(args: {
    normalizedValue: string;
  }): Promise<LegacySignInAccount | null>;
}

/**
 * What the address's account holds, for the sign-in router (ADR-117).
 *
 * Finalized users resolve from the Identifier projection. A miss falls back
 * to legacy User/Account/Passkey rows only when that user's D01 migration has
 * not latched, preserving the same per-user fork as the storage adapter.
 * Detached identifiers never count, and the repository exposes only method
 * presence, never credential material.
 */
export class ProjectionSignInAccountLookup implements SignInAccountLookupPort {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly legacy: LegacySignInAccountDirectory,
    private readonly isLatched: IdentityUserGate,
    /** Whether the Auth0 connection bridge routes brokered subjects to
     *  their own branded methods (`utils/auth0-bridge.ts`) — a composition
     *  decision, handed in so this class never reads the environment. */
    private readonly auth0BridgeIsActive: boolean = false,
  ) {}

  async findAccountMethods({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<AccountSignInMethods | null> {
    const holder = await this.heads.findActiveIdentifierByValue({
      normalizedValue,
    });
    if (!holder) {
      return await this.findLegacyAccountMethods({ normalizedValue });
    }
    if (!(await this.isLatched({ userId: holder.userId }))) {
      return await this.findLegacyAccountMethods({
        normalizedValue,
        knownUnlatchedUserId: holder.userId,
      });
    }

    const heads = await this.heads.findHeads({ userId: holder.userId });
    const live = Object.values(heads.identifiers).filter((identifier) =>
      isLiveIdentifierState(identifier.state),
    );

    return {
      hasPassword: live.some(
        (identifier) => identifier.provider === "credential",
      ),
      hasPasskey: live.some((identifier) => identifier.provider === "passkey"),
      providerIds: [
        ...new Set(
          live
            .map((identifier) => this.routedProviderId(identifier))
            .filter((id): id is string => id !== null),
        ),
      ],
      // Deduplicated, because one connection can back several identifiers for
      // the same person — a work address and an alias on the same provider —
      // and the router ranks connections, not rows.
      connectionIds: [
        ...new Set(
          live
            .map((identifier) => identifier.connectionId)
            .filter((id): id is string => id !== null),
        ),
      ],
    };
  }

  private async findLegacyAccountMethods({
    normalizedValue,
    knownUnlatchedUserId,
  }: {
    normalizedValue: string;
    knownUnlatchedUserId?: string;
  }): Promise<AccountSignInMethods | null> {
    const account = await this.legacy.findLegacySignInAccount({
      normalizedValue,
    });
    if (!account) {
      return null;
    }
    const alreadyKnownUnlatched = knownUnlatchedUserId === account.userId;
    if (
      !alreadyKnownUnlatched &&
      (await this.isLatched({ userId: account.userId }))
    ) {
      return null;
    }

    return this.bridgedLegacyMethods(account);
  }

  /**
   * The rail id an identifier's sign-in belongs to. Verbatim, except an
   * Auth0-brokered subject the connection bridge names, which is routed to
   * its own branded button — so an account that only ever signed in with
   * Google through the broker is answered "Google", and the router's
   * sole-federated redirect lands them on Google's own screen in one step.
   * A subject the bridge cannot name keeps the plain method: those sign-ins
   * belong on Auth0's own screen.
   */
  private routedProviderId(identifier: {
    providerId: string | null;
    providerAccountId: string | null;
  }): string | null {
    if (!this.auth0BridgeIsActive || identifier.providerId !== "auth0") {
      return identifier.providerId;
    }
    if (identifier.providerAccountId === null) return "auth0";
    return auth0BridgeMethodForSubject(identifier.providerAccountId) ?? "auth0";
  }

  /** The same routing over the legacy answer, whose subjects ride beside the
   *  methods because `AccountSignInMethods` deliberately carries kinds only. */
  private bridgedLegacyMethods(
    account: LegacySignInAccount,
  ): AccountSignInMethods {
    if (
      !this.auth0BridgeIsActive ||
      !account.methods.providerIds.includes("auth0")
    ) {
      return account.methods;
    }
    const routed = account.auth0Subjects.map(
      (subject) => auth0BridgeMethodForSubject(subject) ?? "auth0",
    );
    return {
      ...account.methods,
      providerIds: [
        ...new Set([
          ...account.methods.providerIds.filter((id) => id !== "auth0"),
          // A row list with no subjects keeps the plain method: an Auth0
          // sign-in the bridge cannot place still needs its door.
          ...(routed.length > 0 ? routed : ["auth0"]),
        ]),
      ],
    };
  }
}
