import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  normalizeDomain,
  normalizeIdentifierValue,
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  SsoDomainNotVerifiedError,
  SsoExistingAccountUnconfirmedError,
  type SsoUserResolution,
  type SsoUserResolutionInput,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import type {
  SsoRegistrantReadRepository,
  SsoResolutionCandidate,
} from "../repositories/sso-registrant.repository.ts";

const CONTINUE = { action: "continue" } as const;
const REFUSE = { action: "reject", code: "OAuthAccountNotLinked" } as const;
const logger = createLogger("langwatch:identity:sso-user-resolution");

interface SsoUserResolutionServiceDeps {
  /** Identity's own person rows: `User`, `Account`, `Identifier`, credentials. */
  people: SsoRegistrantReadRepository;
  connections: SsoConnectionReadRepository;
  /** The directory's word on a person: scim owns those rows. */
  directory: Pick<ScimApi, "isDirectoryUserInactive" | "findDirectoryConnectionsForUser">;
  /** Whether the person's membership is live: organization owns those rows. */
  memberships: Pick<OrganizationApi, "getMember">;
  /** LangWatch Cloud, where anybody may register a password account. */
  isHosted: boolean;
}

/**
 * Selects the existing person an admitted SAML or connection-owned SCIM
 * assertion signs in as. Main's `PrismaScimSsoUsers.resolve`, branch for
 * branch; asked after the domain gate, never instead of it.
 */
export class SsoUserResolutionService {
  static create(deps: SsoUserResolutionServiceDeps): SsoUserResolutionService {
    return new SsoUserResolutionService(deps);
  }

  private constructor(private readonly deps: SsoUserResolutionServiceDeps) {}

  async resolveUser(input: SsoUserResolutionInput): Promise<SsoUserResolution> {
    // decide() already refused a missing connection, so one vanishing since then throws.
    const connection = await this.deps.connections.getConnection({
      connectionId: input.providerId,
    });
    const email = normalizeIdentifierValue(input.email);
    const candidates = await this.deps.people.findUsersByEmail({ email });

    if (await this.isDirectoryInactive({ connection, input, candidates })) return REFUSE;
    if (candidates.length > 1) return REFUSE;
    const user = candidates[0];
    if (!user) return CONTINUE;

    if (this.isUnvouched(input)) return this.resolveUnvouchedAddress({ connection, input, user });
    if (user.emailVerified) {
      return input.protocol === "saml"
        ? this.resolveVerifiedSamlUser({ input, user, email })
        : this.resolveConfirmedOidcUser({ connection, input, user, email });
    }
    if (!(await this.directoryOwns({ connection, input, userId: user.id }))) {
      return this.resolveUnconfirmedUser({ connection, input, user, email });
    }
    if (user.deactivated || !(await this.hasActiveMembership({ connection, userId: user.id }))) {
      return REFUSE;
    }
    return this.resolveOwnedUser({ input, userId: user.id, email });
  }

  /**
   * An OIDC sign-in with no word from the provider that the address is real.
   * SAML carries no flag and was admitted by the domain gate. Cloud takes only
   * `email_verified: true`; self-hosted refuses only an explicit "unverified".
   */
  private isUnvouched(input: SsoUserResolutionInput): boolean {
    if (input.protocol !== "oidc") return false;
    return this.deps.isHosted ? !input.emailVerified : input.emailVerification === "unverified";
  }

  /** An existing subject binding still names an inactive member after the
   *  provider changes its email claim; directory aliases name nobody. */
  private async isDirectoryInactive({
    connection,
    input,
    candidates,
  }: {
    connection: SsoConnectionState;
    input: SsoUserResolutionInput;
    candidates: readonly SsoResolutionCandidate[];
  }): Promise<boolean> {
    const holders = await this.deps.people.findBindingHolderIds({
      connectionId: input.providerId,
      accountKey: input.accountKey,
    });
    const userIds = new Set([...candidates.map((candidate) => candidate.id), ...holders]);
    for (const userId of userIds) {
      const inactive = await this.deps.directory.isDirectoryUserInactive({
        organizationId: connection.organizationId,
        userId,
      });
      if (inactive) return true;
    }
    return false;
  }

  private async resolveVerifiedSamlUser({
    input,
    user,
    email,
  }: {
    input: SsoUserResolutionInput;
    user: SsoResolutionCandidate;
    email: string;
  }): Promise<SsoUserResolution> {
    if (input.protocol !== "saml") return CONTINUE;
    if (user.deactivated) return REFUSE;
    const contested = await this.deps.people.isAddressOrSubjectHeldByAnother({
      userId: user.id,
      email,
      accountKey: input.accountKey,
    });
    if (contested) return REFUSE;
    // A repeat sign-in of a linked identity continues: the binding is reused.
    if (await this.holdsThisBinding({ input, userId: user.id })) return CONTINUE;
    // Native linking rechecks the exact issuer/subject owner and provider.
    return { action: "link", userId: user.id, profile: "preserve" };
  }

  /**
   * A confirmed account an OIDC provider signs in on self-hosted without
   * `email_verified: true`: linked on the connection's domain proof or Entra ID's
   * `xms_edov: true`, otherwise refused with the missing domain proof named.
   */
  private async resolveConfirmedOidcUser({
    connection,
    input,
    user,
    email,
  }: {
    connection: SsoConnectionState;
    input: SsoUserResolutionInput;
    user: SsoResolutionCandidate;
    email: string;
  }): Promise<SsoUserResolution> {
    if (this.deps.isHosted || input.emailVerified) return CONTINUE;
    if (user.deactivated) return REFUSE;
    if (await this.holdsThisBinding({ input, userId: user.id })) return CONTINUE;
    if (
      input.emailVerification !== "verified" &&
      !connectionProvesDomainOf({ connection, email: input.email })
    ) {
      return refuseUnprovedDomain({ providerId: input.providerId });
    }
    const contested = await this.deps.people.isAddressOrSubjectHeldByAnother({
      userId: user.id,
      email,
      accountKey: input.accountKey,
    });
    if (contested) return REFUSE;
    return { action: "link", userId: user.id, profile: "preserve" };
  }

  /** An OIDC provider that does not vouch for the address (said "unverified",
   *  or said nothing on Cloud): the library refuses the link either way, and an
   *  unconfirmed account this connection's directory does not own gets the
   *  named refusal instead. */
  private async resolveUnvouchedAddress({
    connection,
    input,
    user,
  }: {
    connection: SsoConnectionState;
    input: SsoUserResolutionInput;
    user: SsoResolutionCandidate;
  }): Promise<SsoUserResolution> {
    if (this.deps.isHosted || user.emailVerified) return CONTINUE;
    if (await this.directoryOwns({ connection, input, userId: user.id })) return CONTINUE;
    // A returning person: the library signs an existing binding in without asking again.
    if (await this.holdsThisBinding({ input, userId: user.id })) return CONTINUE;
    return refuseUnconfirmed({
      providerId: input.providerId,
      detail:
        "the provider asserted the address is not verified and the account's address is unconfirmed",
    });
  }

  /**
   * An unconfirmed account on a self-hosted installation, asserted by SAML or
   * by an OIDC provider that did not say "unverified": the connection's
   * qualified domain proof may vouch for it (sso-link-unconfirmed-local-account.feature).
   */
  private async resolveUnconfirmedUser({
    connection,
    input,
    user,
    email,
  }: {
    connection: SsoConnectionState;
    input: SsoUserResolutionInput;
    user: SsoResolutionCandidate;
    email: string;
  }): Promise<SsoUserResolution> {
    if (this.deps.isHosted) return CONTINUE;
    if (user.deactivated) return REFUSE;
    if (await this.holdsThisBinding({ input, userId: user.id })) return CONTINUE;
    if (!connectionProvesDomainOf({ connection, email: input.email })) {
      return refuseUnconfirmed({
        providerId: input.providerId,
        detail: "the connection has no qualified proof for the unconfirmed account's domain",
      });
    }
    const contested = await this.deps.people.isAddressOrSubjectHeldByAnother({
      userId: user.id,
      email,
      accountKey: input.accountKey,
    });
    if (contested) return REFUSE;
    // The proof vouches for the address: confirmed and linked in the library's own commit.
    return { action: "link", userId: user.id, profile: "preserve", confirmAddress: true };
  }

  private async resolveOwnedUser({
    input,
    userId,
    email,
  }: {
    input: SsoUserResolutionInput;
    userId: string;
    email: string;
  }): Promise<SsoUserResolution> {
    const accounts = await this.deps.people.findAccountsForUserOrSubject({
      userId,
      accountKey: input.accountKey,
    });
    if (accounts.length > 0) {
      const alreadyLinked = accounts.some(
        (account) =>
          account.userId === userId &&
          account.provider === input.providerId &&
          account.issuer === input.accountKey.issuer &&
          account.providerAccountId === input.accountKey.accountId,
      );
      if (!alreadyLinked) return REFUSE;
      return input.protocol === "saml" ? CONTINUE : { action: "link", userId, profile: "preserve" };
    }
    if (await this.deps.people.hasStoredCredential({ userId })) return REFUSE;
    const proven = await this.deps.people.hasProvingIdentifier({
      userId,
      email,
      accountKey: input.accountKey,
    });
    if (proven) return REFUSE;
    return { action: "link", userId, profile: "preserve" };
  }

  /** Whether the account already holds this connection's exact subject. */
  private async holdsThisBinding({
    input,
    userId,
  }: {
    input: SsoUserResolutionInput;
    userId: string;
  }): Promise<boolean> {
    const holders = await this.deps.people.findBindingHolderIds({
      connectionId: input.providerId,
      accountKey: input.accountKey,
    });
    return holders.includes(userId);
  }

  /** This connection's directory sync provisioned the person, or the sync of
   *  the connection it replaces did: until the update finishes that row has
   *  not moved, and both belong to the same organization. */
  private async directoryOwns({
    connection,
    input,
    userId,
  }: {
    connection: SsoConnectionState;
    input: SsoUserResolutionInput;
    userId: string;
  }): Promise<boolean> {
    const owners = await this.deps.directory.findDirectoryConnectionsForUser({
      organizationId: connection.organizationId,
      userId,
    });
    if (owners.includes(input.providerId)) return true;
    const replaced = connection.replacesConnectionId;
    return replaced !== null && owners.includes(replaced);
  }

  private async hasActiveMembership({
    connection,
    userId,
  }: {
    connection: SsoConnectionState;
    userId: string;
  }): Promise<boolean> {
    try {
      const member = await this.deps.memberships.getMember({
        organizationId: connection.organizationId,
        userId,
      });
      return member.disabledAt === null;
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "member_not_found") return false;
      throw error;
    }
  }
}

/** Whether this connection holds a QUALIFIED proof for the asserted address's
 *  domain. A lapsed or incomplete proof does not count. */
function connectionProvesDomainOf({
  connection,
  email,
}: {
  connection: SsoConnectionState;
  email: string;
}): boolean {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1 || at !== email.lastIndexOf("@")) {
    return false;
  }
  const domain = normalizeDomain(email.slice(at + 1));
  return qualifySsoDomainOwnership({ state: connection, domain }).status === "QUALIFIED";
}

/** A confirmed account the provider did not vouch for, on a domain the
 *  connection has no proof for: named, so the screen can say which proof is
 *  missing instead of "account already exists". The person signing in is often
 *  the administrator testing the connection, and verifying the domain is theirs. */
function refuseUnprovedDomain({ providerId }: { providerId: string }): SsoUserResolution {
  const detail =
    "the provider sent no email verification claim and the connection has no qualified proof for the address's domain";
  const error = new SsoDomainNotVerifiedError(detail);
  logger.info({ code: error.code, providerId }, `single sign-on link refused: ${detail}`);
  return { action: "reject", code: "sso_domain_not_verified" };
}

/** Logged with its cause because the library carries only the code onward. */
function refuseUnconfirmed({
  providerId,
  detail,
}: {
  providerId: string;
  detail: string;
}): SsoUserResolution {
  const error = new SsoExistingAccountUnconfirmedError(detail);
  logger.info({ code: error.code, providerId }, `single sign-on link refused: ${detail}`);
  return { action: "reject", code: "sso_existing_account_unconfirmed" };
}
