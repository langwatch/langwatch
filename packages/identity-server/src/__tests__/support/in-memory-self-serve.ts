import type { BreakGlassBinding } from "@langwatch/identity";
import type {
  SsoBreakGlassReadPort,
  SsoConnectionRoutingLookup,
  SsoOrganizationMember,
  SsoOrganizationMemberLookup,
  SsoTestSignIn,
  SsoTestSignInLookup,
} from "../../sso-self-serve.service";

/**
 * The four seams the self-serve setup surface grew for going live (wave 3):
 * the account store, the bindings, the directory, and the rollout flag.
 *
 * Each one is a real question about the world that this package deliberately
 * cannot answer for itself — whether anybody signed in, who can still get in
 * without the identity provider, who they are, and whether the auth screens has
 * moved. Doubles here so a scenario can hold each answer still.
 */

/**
 * Whether anybody has come back through the connection.
 *
 * Keyed by connection AND organization, because that is the pair the port is
 * asked about: a double keyed on the connection alone would answer another
 * organization's question and hide exactly the scoping bug the real lookup
 * has to avoid.
 */
export class StubTestSignIns implements SsoTestSignInLookup {
  private readonly held = new Map<string, SsoTestSignIn>();

  record({
    organizationId,
    connectionId,
    signIn,
  }: {
    organizationId: string;
    connectionId: string;
    signIn: SsoTestSignIn;
  }): void {
    this.held.set(`${organizationId}:${connectionId}`, signIn);
  }

  forget(): void {
    this.held.clear();
  }

  async findLatestForConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoTestSignIn | null> {
    return this.held.get(`${organizationId}:${connectionId}`) ?? null;
  }
}

/** The ways back in, as rows. Live-ness is the service's to decide from the
 *  dates, so this double holds dates and never a boolean. */
export class StubBreakGlassReads implements SsoBreakGlassReadPort {
  bindings: BreakGlassBinding[] = [];

  async history(): Promise<BreakGlassBinding[]> {
    return this.bindings;
  }
}

export class StubMembers implements SsoOrganizationMemberLookup {
  constructor(
    public administrators: SsoOrganizationMember[] = [],
    public everybody: SsoOrganizationMember[] = [],
  ) {}

  async findAdministrators(): Promise<SsoOrganizationMember[]> {
    return this.administrators;
  }

  async findByIds({
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<SsoOrganizationMember[]> {
    const known = [...this.administrators, ...this.everybody];
    return known.filter((person) => userIds.includes(person.userId));
  }
}

export class StubRouting implements SsoConnectionRoutingLookup {
  constructor(private on = false) {}

  set(on: boolean): void {
    this.on = on;
  }

  async routesOffConnection(): Promise<boolean> {
    return this.on;
  }
}

/** A binding with the dates a scenario cares about and defaults for the rest. */
export function bindingFor({
  bindingId = "bgb_1",
  organizationId,
  userId = "user_ana",
  grantedByUserId = "user_ana",
  grantedAtMs,
  expiresAtMs,
  supersededAtMs = null,
}: {
  bindingId?: string;
  organizationId: string;
  userId?: string;
  grantedByUserId?: string;
  grantedAtMs: number;
  expiresAtMs: number;
  supersededAtMs?: number | null;
}): BreakGlassBinding {
  return {
    bindingId,
    organizationId,
    userId,
    grantedByUserId,
    grantedAtMs,
    expiresAtMs,
    supersededAtMs,
    renewedFromBindingId: null,
    warnedDays: [],
  };
}
