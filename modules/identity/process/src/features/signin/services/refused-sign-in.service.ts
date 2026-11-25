import {
  SsoConnectionNotFoundError,
  type RefusedSignInClassification,
  type RefusedSignInInput,
  type SignInIdpKind,
  type SsoConnectionState,
} from "@langwatch/identity-contract";

import {
  classifyConnectionIdpKind,
  classifyProviderIdpKind,
  extractEmailDomain,
} from "../rules/refused-sign-in-idp.rules.ts";

/** The organization's answer to a refused sign-in it now knows about. */
export interface RefusedSignInSeats {
  recordRefusedSignIn(input: {
    organizationId: string;
    email: string;
    idp: SignInIdpKind;
  }): Promise<{ outcome: "seat_limit" | "refused" }>;
}

interface RefusedSignInDeps {
  connections: { getConnection(args: { connectionId: string }): Promise<SsoConnectionState> };
  seats: RefusedSignInSeats;
}

/**
 * Classifies a sign-in an identity provider refused. Only an organization's own connection names
 * an organization, and only an address on one of its verified domains is recorded with it, so a
 * forged refusal cannot raise a seat request at an organization the address has no claim on.
 * @see specs/identity/idp-refused-sign-in.feature
 */
export class RefusedSignInService {
  static create(deps: RefusedSignInDeps): RefusedSignInService {
    return new RefusedSignInService(deps);
  }

  private constructor(private readonly deps: RefusedSignInDeps) {}

  async classify({ refusedBy, email }: RefusedSignInInput): Promise<RefusedSignInClassification> {
    if (refusedBy.kind === "provider") {
      const idp = classifyProviderIdpKind({ providerId: refusedBy.providerId }) ?? null;
      return { organizationId: null, idp, outcome: "refused" };
    }

    const connection = await this.findConnection(refusedBy.connectionId);
    if (!connection) return { organizationId: null, idp: null, outcome: "refused" };

    const organizationId = connection.organizationId;
    const idp = classifyConnectionIdpKind({
      issuer: connection.idpMetadata.issuer,
      type: connection.type,
    });
    const address = email?.trim().toLowerCase();
    const domain = address ? extractEmailDomain(address) : undefined;
    if (!address || !domain || !connection.verifiedDomains.includes(domain)) {
      return { organizationId, idp, outcome: "refused" };
    }

    const { outcome } = await this.deps.seats.recordRefusedSignIn({
      organizationId,
      email: address,
      idp,
    });
    return { organizationId, idp, outcome };
  }

  private async findConnection(connectionId: string): Promise<SsoConnectionState | undefined> {
    try {
      return await this.deps.connections.getConnection({ connectionId });
    } catch (error) {
      if (error instanceof SsoConnectionNotFoundError) return undefined;
      throw error;
    }
  }
}
