import {
  type AttachIdentifierCommandData,
  type DetachIdentifierCommandData,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  type IdentifierFact,
  type IdentityFact,
  type IdentityFactOf,
  IdentityIdentifierAlreadyHeldError,
  IdentityIdentifierNotFoundError,
  type MarkPrimaryCommandData,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import {
  detachStrandsUser,
  type IdentityHeadsRepository,
  type VerificationCeremonyService,
} from "@langwatch/identity-server";

/**
 * The three identity verbs this surface needs, as a port.
 *
 * Named here rather than taken as `IdentityService` so the service depends on
 * what it uses: the composition root passes the real one, and a test passes
 * three functions.
 */
export interface AccountIdentifierWrites {
  attachIdentifier(input: AttachIdentifierCommandData): Promise<IdentityFact[]>;
  detachIdentifier(input: DetachIdentifierCommandData): Promise<IdentityFact[]>;
  markPrimary(input: MarkPrimaryCommandData): Promise<IdentityFact[]>;
}

export interface AccountIdentifiersDeps {
  /** Sends the confirmation link. The service never renders or posts mail. */
  sendConfirmation(args: {
    email: string;
    verificationUrl: string;
  }): Promise<void>;
  /** Builds the link the mail carries, from the deployment's own base URL. */
  buildConfirmationUrl(args: {
    identifierId: string;
    verificationId: string;
    token: string;
  }): string;
  newCommandId(): string;
  now(): number;
}

/** One row of the authentication settings page's address list. */
export interface AccountIdentifier {
  identifierId: string;
  /** The better-auth `Account` row this mirrors, where one exists. It is how
   *  the sign-in-methods list matches a protocol row to the guard's verdict
   *  about giving it up. */
  accountId: string | null;
  provider: IdentifierFact["provider"];
  /** The address, or the provider's own name for a federated identifier. */
  value: string | null;
  isPrimary: boolean;
  /** Whether anything has been proved about it. */
  confirmed: boolean;
  /** Whether a confirmation link can be sent for it. */
  resendable: boolean;
  /** Whether Remove is offered at all. */
  removable: boolean;
  /**
   * The registered code the guard would refuse with, when it is not
   * removable. The words a person reads come from the client's presentation
   * registry, keyed by this — never from a sentence written here.
   */
  refusalCode: string | null;
  /** Whether removing it demotes another identifier to primary first. */
  demotesFirst: boolean;
}

/**
 * The account's own sign-in addresses: what it holds, adding one, confirming
 * one, and giving one up (D01's identifiers, on the surface D07's detach
 * guards point at).
 *
 * The guard's remediation copy has said "add a verified email address first"
 * since the guard shipped, and until now there was nowhere to do that. This
 * is that door, and it is deliberately built out of the SAME pieces the rest
 * of identity is: the attach is a command, the confirmation is D01's PKCE
 * ceremony, the removal is the detach command, and the reason Remove is
 * greyed out is `detachStrandsUser` — the guard's own predicate, not a
 * second opinion about it.
 *
 * No Prisma reaches here: the heads repository is the read, the write port is
 * the three commands, and the mailer is a closure the composition root binds.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
export class AccountIdentifiersService {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly identity: AccountIdentifierWrites,
    private readonly ceremony: VerificationCeremonyService,
    private readonly deps: AccountIdentifiersDeps,
  ) {}

  /**
   * Every way in this account holds, and — for each — what the guard would
   * say if it were given up.
   *
   * The refusal is computed BEFORE the click, from one read of the heads, so
   * the screen can stand its Remove control down and say why. The route still
   * asks the guard when the click comes: this is the guard read out loud, not
   * the guard moved.
   */
  async listIdentifiers({
    userId,
  }: {
    userId: string;
  }): Promise<AccountIdentifier[]> {
    const heads = await this.heads.findHeads({ userId });
    const live = Object.values(heads.identifiers).filter(
      (head) => head.state !== "DETACHED",
    );

    return live
      .sort((left, right) => left.attachedAtMs - right.attachedAtMs)
      .map((head) => {
        const isActive = head.state === "VERIFIED" || head.state === "PRIMARY";
        // An identifier nobody could have signed in with strands nobody, so
        // it stays removable — the shipped reachability semantics, kept.
        const strands = isActive
          ? detachStrandsUser({ heads, identifierId: head.identifierId })
          : null;
        return {
          identifierId: head.identifierId,
          accountId: head.accountId,
          provider: head.provider,
          value: head.value,
          isPrimary: head.state === "PRIMARY",
          confirmed: isActive,
          // Only an email can be confirmed by an emailed link, and only one
          // that has not been.
          resendable: head.provider === "email" && !isActive,
          removable: strands === null,
          refusalCode: strands?.code ?? null,
          demotesFirst: head.state === "PRIMARY",
        };
      });
  }

  /**
   * Add another address, unverified, and send it a confirmation link.
   *
   * Two things it is NOT. It is not a way in until the ceremony completes —
   * the identifier arrives ATTACHED, which nothing can sign in with and
   * nothing can be recovered through. And it is not a way to learn who holds
   * an address: the only refusal here is for an address ALREADY ON THIS
   * ACCOUNT, which tells the caller nothing they did not already know.
   *
   * An address somebody else holds is deliberately NOT refused here. Attaching
   * is not claiming: an unverified identifier blocks nobody, so there is no
   * squatting, and the cross-population uniqueness guard refuses it at VERIFY
   * with `identity_email_in_use` — which is the one place the check can happen
   * without the endpoint becoming an existence oracle for anybody with an
   * account. What the stranger gets is a confirmation mail they can ignore,
   * throttled per caller.
   *
   * The PKCE challenge belongs to the browser that asked. Completion needs
   * the verifier that browser kept, so a forwarded link — or a mail scanner
   * following it — confirms nothing.
   */
  async addEmailIdentifier({
    userId,
    email,
    codeChallenge,
  }: {
    userId: string;
    email: string;
    codeChallenge: string;
  }): Promise<{ identifierId: string }> {
    const normalizedValue = normalizeIdentifierValue(email);
    const holder = await this.heads.findActiveIdentifierByValue({
      normalizedValue,
    });
    if (holder?.userId === userId) {
      throw new IdentityIdentifierAlreadyHeldError(
        `add_email_identifier: ${normalizedValue} is already live on this account`,
      );
    }

    const occurredAtMs = this.deps.now();
    const facts = await this.identity.attachIdentifier({
      tenantId: userId,
      userId,
      commandId: this.deps.newCommandId(),
      // No protocol row and no provider subject: an address somebody typed
      // into their own settings is a claim about a mailbox, and the only
      // thing that will ever prove it is the emailed ceremony.
      accountId: null,
      provider: "email",
      providerId: null,
      // Null exactly when `providerId` is, which the schema requires and
      // this ceremony satisfies: nobody asserted this address but its owner.
      issuer: null,
      providerAccountId: null,
      value: email,
      occurredAtMs,
      ceremony: { flow: "settings-add-address" },
      actor: { type: "user", id: userId },
    });

    const attached = facts.find(
      (fact): fact is IdentityFactOf<typeof IDENTIFIER_ATTACHED_EVENT_TYPE> =>
        fact.type === IDENTIFIER_ATTACHED_EVENT_TYPE,
    );
    if (!attached) {
      // The guard states nothing when the heads already carry the identifier,
      // which for this verb means the address is already on the account in a
      // state the uniqueness read did not catch — a detached one being
      // re-attached at the same instant. One answer either way.
      throw new IdentityIdentifierAlreadyHeldError(
        `add_email_identifier: nothing was attached for ${normalizedValue}`,
      );
    }

    const identifierId = attached.data.identifierId;
    await this.sendConfirmationFor({ userId, identifierId, codeChallenge });
    return { identifierId };
  }

  /**
   * Send the confirmation link again, for an address that has not been
   * confirmed.
   *
   * A fresh ceremony every time rather than a re-send of the old token: the
   * record is replaced for the identifier, so the newest link is the only one
   * that works and the browser asking now is the one that can finish it.
   */
  async resendConfirmation({
    userId,
    identifierId,
    codeChallenge,
  }: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<void> {
    await this.sendConfirmationFor({ userId, identifierId, codeChallenge });
  }

  /**
   * Give up a way in.
   *
   * The primary one demotes before it detaches — the state machine's rule
   * (D01), not this surface's — so a removal that would otherwise be refused
   * outright becomes two commands the person took as one action. Which
   * identifier takes over is the most recently confirmed one that a message
   * could reach, because the point of having a primary is that somebody can
   * be written to.
   */
  async removeIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<void> {
    const heads = await this.heads.findHeads({ userId });
    const head = heads.identifiers[identifierId];
    if (!head || head.state === "DETACHED") {
      throw new IdentityIdentifierNotFoundError(
        `remove_identifier: ${identifierId} is not a live identifier of this user`,
      );
    }

    if (head.state === "PRIMARY") {
      const successor = this.successorTo({ heads, identifierId });
      if (successor) {
        await this.identity.markPrimary({
          tenantId: userId,
          userId,
          commandId: this.deps.newCommandId(),
          identifierId: successor.identifierId,
          occurredAtMs: this.deps.now(),
          actor: { type: "user", id: userId },
        });
      }
      // With no successor the detach below is refused by the guard, which is
      // the correct answer and the one whose copy the screen already shows.
    }

    await this.identity.detachIdentifier({
      tenantId: userId,
      userId,
      commandId: this.deps.newCommandId(),
      identifierId,
      occurredAtMs: this.deps.now(),
      actor: { type: "user", id: userId },
    });
  }

  /** The identifier that takes PRIMARY over, or null when none can. */
  private successorTo({
    heads,
    identifierId,
  }: {
    heads: Awaited<ReturnType<IdentityHeadsRepository["findHeads"]>>;
    identifierId: string;
  }): IdentifierFact | null {
    const candidates = Object.values(heads.identifiers).filter(
      (head) => head.identifierId !== identifierId && head.state === "VERIFIED",
    );
    // An address first: primary is the one a recovery message goes to, and a
    // passkey has no address at all.
    const addressed = candidates.filter((head) => head.provider !== "passkey");
    const pool = addressed.length > 0 ? addressed : candidates;
    return (
      pool.sort(
        (left, right) =>
          (right.verifiedAtMs ?? right.attachedAtMs) -
          (left.verifiedAtMs ?? left.attachedAtMs),
      )[0] ?? null
    );
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
    const head = await this.heads.findIdentifier({ userId, identifierId });
    if (!head?.value) {
      throw new IdentityIdentifierNotFoundError(
        `send_confirmation: ${identifierId} is not an addressable identifier of this user`,
      );
    }
    // The ceremony refuses anything that is not this user's ATTACHED email
    // identifier, so nothing here re-checks that.
    const minted = await this.ceremony.mintEmailVerification({
      userId,
      identifierId,
      codeChallenge,
    });
    await this.deps.sendConfirmation({
      email: head.value,
      verificationUrl: this.deps.buildConfirmationUrl({
        identifierId,
        verificationId: minted.verificationId,
        token: minted.token,
      }),
    });
  }
}
