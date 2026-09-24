import type { MigrationIdentifierBinding } from "../rules/sso-migration.rules.ts";

/** One live identifier, with who holds it. */
export interface MigrationIdentifierHolding extends MigrationIdentifierBinding {
  /** The row's own id: what a retirement detaches, and what the way-in check
   *  promotes when the legacy half was primary. */
  identifierId: string;
  userId: string;
  /** VERIFIED and PRIMARY are the two that count as proved. */
  state: string;
  /** The kind of way in: `email`, `passkey`, or a provider's name. */
  provider: string;
  /** When it was last proved; null for one nothing proved. */
  verifiedAtMs: number | null;
}

/** One sign-in a connection decided, as the trail records it. */
export interface SsoAuthenticationRecord {
  organizationId: string;
  connectionId: string;
  userId: string;
  authenticatedAtMs: number;
  /** The subject the provider asserted, when the door knew it: what going
   *  live records as the test sign-in's account. */
  providerAccountId: string | null;
}

/**
 * The authentication trail a connection leaves, and what the migration pair
 * is judged on over identity's own rows: which identifiers each member
 * holds. Membership is the organization module's and is asked there.
 */
export abstract class SsoMigrationEvidenceRepository {
  /** One successful sign-in through a connection, as it happened. */
  abstract recordAuthentication(record: SsoAuthenticationRecord): Promise<void>;

  /** Every live identifier held by any of these users. */
  abstract findLiveIdentifierHoldings(args: {
    userIds: string[];
  }): Promise<MigrationIdentifierHolding[]>;

  /** This connection's sign-ins, newest first. The empty list is a
   *  connection nobody has signed in through. */
  abstract findRecentAuthentications(args: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<SsoAuthenticationRecord[]>;

  /** When this connection last signed anybody in, or null. */
  abstract findLastAuthenticationAtMs(args: {
    organizationId: string;
    connectionId: string;
  }): Promise<number | null>;

  /** When it last signed each of these people in. Absent means never. */
  abstract findLastAuthenticationByUser(args: {
    organizationId: string;
    connectionId: string;
    userIds: string[];
  }): Promise<Map<string, number>>;

  /** How many accounts hold each address, keyed by the address lowercased. An
   *  address nobody holds is absent. */
  abstract countAddressHolders(args: { addresses: string[] }): Promise<Map<string, number>>;
}
