import type { AuthApi } from "@langwatch/auth-contract";
import { FrontDoorRateLimitedError } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  type AccountIdentifier,
  type EmailIdentifierAdded,
  type IdentifierFact,
  type IdentityHeads,
  IdentityIdentifierAlreadyHeldError,
  IdentityIdentifierNotFoundError,
  type MethodsLastUsed,
  normalizeIdentifierValue,
} from "@langwatch/identity-contract";
import type { RateLimiter } from "@langwatch/process-stores";
import { Temporal } from "@langwatch/time";

import type { AddressConfirmationMailChannel } from "../channels/address-confirmation-mail.channel.ts";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import { newIdentityCommandId } from "../rules/identity-command-id.rules.ts";
import { assertDetachKeepsWayBack } from "../rules/identity-detach.rules.ts";
import type { IdentityService } from "./identity.service.ts";
import type { VerificationCeremonyService } from "./verification-ceremony.service.ts";

/** Main's throttle on the two verbs that mail an unproved address. */
const CONFIRMATION_MAILS_PER_HOUR = 10;
const HOUR_SECONDS = 60 * 60;

export interface AccountIdentifiersServiceDeps {
  heads: IdentityHeadsRepository;
  identity: Pick<IdentityService, "attachIdentifier" | "markPrimary" | "detachIdentifier">;
  ceremony: Pick<VerificationCeremonyService, "mintEmailVerification">;
  mail: AddressConfirmationMailChannel;
  rateLimiter: RateLimiter;
  sessions: Pick<AuthApi, "listBrowserSessions">;
  now?: () => number;
}

/**
 * The account's own sign-in addresses: listing, adding, confirming and giving one up, built from
 * identity's own pieces — the attach and detach commands, D01's PKCE ceremony, and the detach
 * guard's own predicate for hiding Remove. Spec: specs/identity/authentication-settings.feature
 */
export class AccountIdentifiersService {
  private readonly deps: AccountIdentifiersServiceDeps;
  private readonly now: () => number;

  static create(deps: AccountIdentifiersServiceDeps): AccountIdentifiersService {
    return new AccountIdentifiersService(deps);
  }

  private constructor(deps: AccountIdentifiersServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** The guard read out loud before the click; `removeIdentifier` still asks it. */
  async listIdentifiers({ userId }: { userId: string }): Promise<AccountIdentifier[]> {
    const heads = await this.deps.heads.findHeads({ userId });

    return Object.values(heads.identifiers)
      .filter((head) => head.state !== "DETACHED")
      .toSorted((left, right) => left.attachedAtMs - right.attachedAtMs)
      .map((head) => {
        const isActive = head.state === "VERIFIED" || head.state === "PRIMARY";
        // An identifier nobody could have signed in with strands nobody.
        const verdict: DetachVerdict = isActive
          ? detachVerdict({ heads, identifierId: head.identifierId })
          : { removable: true };
        return {
          identifierId: head.identifierId,
          accountId: head.accountId,
          provider: head.provider,
          value: head.value,
          isPrimary: head.state === "PRIMARY",
          confirmed: isActive,
          resendable: head.provider === "email" && !isActive,
          removable: verdict.removable,
          refusalCode: verdict.removable ? null : verdict.refusalCode,
          demotesFirst: head.state === "PRIMARY",
        };
      });
  }

  /**
   * Attaches the address unverified and mails its confirmation. Only an address already on THIS
   * account is refused: somebody else's is refused at verification, where it is no oracle.
   */
  async addEmailIdentifier({
    userId,
    email,
    codeChallenge,
  }: {
    userId: string;
    email: string;
    codeChallenge: string;
  }): Promise<EmailIdentifierAdded> {
    await this.meter({ key: `identity.addEmailIdentifier:${userId}` });

    const normalizedValue = normalizeIdentifierValue(email);
    const holders = await this.activeHolders({ normalizedValue });
    if (holders.some((holder) => holder.userId === userId)) {
      throw new IdentityIdentifierAlreadyHeldError(
        `add_email_identifier: ${normalizedValue} is already live on this account`,
      );
    }

    await this.deps.identity.attachIdentifier({
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      accountId: null,
      provider: "email",
      providerId: null,
      issuer: null,
      providerAccountId: null,
      value: email,
      occurredAtMs: this.now(),
      ceremony: { flow: "settings-add-address" },
      actor: { type: "user", id: userId },
    });

    // Read back from the heads, never the returned facts (ADR-135): the link must name a row
    // that exists, and the attach waits for the fold before it returns.
    const heads = await this.deps.heads.findHeads({ userId });
    const attached = Object.values(heads.identifiers).find(
      (head) =>
        head.value === normalizedValue && head.state !== "DETACHED" && head.state !== "DEAD_END",
    );
    if (!attached) {
      throw new IdentityIdentifierAlreadyHeldError(
        `add_email_identifier: nothing live carries ${normalizedValue} after the attach`,
      );
    }

    await this.sendConfirmationFor({ userId, identifierId: attached.identifierId, codeChallenge });
    return { identifierId: attached.identifierId };
  }

  /** A fresh ceremony every time, so the newest link is the only one that works. */
  async resendConfirmation({
    userId,
    identifierId,
    codeChallenge,
  }: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<void> {
    await this.meter({ key: `identity.resendIdentifierConfirmation:${userId}` });
    await this.sendConfirmationFor({ userId, identifierId, codeChallenge });
  }

  /** A primary demotes before it detaches (D01); with no successor the detach guard refuses. */
  async removeIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<void> {
    const heads = await this.deps.heads.findHeads({ userId });
    const head = heads.identifiers[identifierId];
    if (!head || head.state === "DETACHED") {
      throw new IdentityIdentifierNotFoundError(
        `remove_identifier: ${identifierId} is not a live identifier of this user`,
      );
    }

    const [successor] = head.state === "PRIMARY" ? successorsTo({ heads, identifierId }) : [];
    if (successor) {
      await this.deps.identity.markPrimary({
        tenantId: userId,
        userId,
        commandId: newIdentityCommandId(),
        identifierId: successor.identifierId,
        occurredAtMs: this.now(),
        actor: { type: "user", id: userId },
      });
    }

    await this.deps.identity.detachIdentifier({
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      identifierId,
      occurredAtMs: this.now(),
      actor: { type: "user", id: userId },
    });
  }

  /** Newest session first: the first naming a method is its last use. Sessions age out, so an
   *  absent method means "not in any session we still hold", never "never used". */
  async getMethodsLastUsed({ userId }: { userId: string }): Promise<MethodsLastUsed> {
    const sessions = (await this.deps.sessions.listBrowserSessions({ userId })).toSorted(
      (left, right) => instantMs(right.signedInAt) - instantMs(left.signedInAt),
    );

    const byIdentifier: Record<string, string> = {};
    for (const session of sessions) {
      if (session.identifierId && !(session.identifierId in byIdentifier)) {
        byIdentifier[session.identifierId] = session.signedInAt;
      }
    }
    const secondFactor = sessions.find((session) => session.secondFactorProven);

    return { byIdentifier, secondFactorAt: secondFactor?.signedInAt ?? null };
  }

  private async meter({ key }: { key: string }): Promise<void> {
    const decision = await this.deps.rateLimiter.check(key, {
      requests: CONFIRMATION_MAILS_PER_HOUR,
      seconds: HOUR_SECONDS,
    });
    if (!decision.allowed) {
      throw new FrontDoorRateLimitedError("Too many attempts. Please try again later.", {
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
  }

  private async activeHolders({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<{ userId: string }[]> {
    try {
      return [await this.deps.heads.getActiveIdentifierByValue({ normalizedValue })];
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "identity_identifier_not_found") {
        return [];
      }
      throw error;
    }
  }

  private async sendConfirmationFor({
    userId,
    identifierId,
    codeChallenge,
  }: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<void> {
    const head = await this.deps.heads.getIdentifier({ userId, identifierId });
    if (!head.value) {
      throw new IdentityIdentifierNotFoundError(
        `send_confirmation: ${identifierId} is not an addressable identifier of this user`,
      );
    }
    // The ceremony refuses anything but this user's ATTACHED email identifier.
    const minted = await this.deps.ceremony.mintEmailVerification({
      userId,
      identifierId,
      codeChallenge,
    });
    await this.deps.mail.sendConfirmation({
      email: head.value,
      identifierId,
      verificationId: minted.verificationId,
      token: minted.token,
    });
  }
}

type DetachVerdict = { removable: true } | { removable: false; refusalCode: string };

/** The detach guard's own verdict on giving this identifier up, with its refusal code. */
function detachVerdict({
  heads,
  identifierId,
}: {
  heads: IdentityHeads;
  identifierId: string;
}): DetachVerdict {
  try {
    assertDetachKeepsWayBack({ heads, identifierId });
    return { removable: true };
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === "identity_detach_strands_user") {
      return { removable: false, refusalCode: error.code };
    }
    throw error;
  }
}

/** Who takes PRIMARY over, best first: an addressed identifier, most recently confirmed. */
function successorsTo({
  heads,
  identifierId,
}: {
  heads: IdentityHeads;
  identifierId: string;
}): IdentifierFact[] {
  const candidates = Object.values(heads.identifiers).filter(
    (head) => head.identifierId !== identifierId && head.state === "VERIFIED",
  );
  const addressed = candidates.filter((head) => head.provider !== "passkey");
  const pool = addressed.length > 0 ? addressed : candidates;
  return pool.toSorted(
    (left, right) =>
      (right.verifiedAtMs ?? right.attachedAtMs) - (left.verifiedAtMs ?? left.attachedAtMs),
  );
}

function instantMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}
