import {
  type Amr,
  connectionAssertsSecondFactor,
  IdentityMfaEnrollmentRequiredError,
  IdentityMfaRequirementNotLicensedError,
  isAmr,
  type SecondFactorSatisfaction,
  satisfiesOrganizationMfaRequirement,
} from "@langwatch/identity";

/**
 * The organization's membership condition (D06), and everything an
 * administrator needs to run it.
 *
 * `Organization.mfaRequired` means "every member of this organization can
 * prove a second factor". It is asked when a member reaches that
 * organization's data, it holds the ones who cannot at an enrollment gate for
 * THAT organization alone, and it ends no session — not when it is turned on,
 * not when it is turned off, not ever. There is deliberately no session port
 * on this service: the guarantee is structural, not a rule somebody has to
 * remember.
 *
 * The decision itself is `satisfiesOrganizationMfaRequirement` in
 * `@langwatch/identity`, which is where the three ways of satisfying it are
 * written down. This service only supplies the evidence and carries the
 * answer to the surfaces that need it.
 *
 * No Prisma reaches in here. Every read is a port, composed in `runtime.ts`,
 * which is what lets the gate and the administrator's view be tested against
 * the states that matter rather than against a database.
 */

/** What one member can prove, for the administrator's list. */
export interface OrganizationMemberFactor {
  userId: string;
  name: string | null;
  email: string | null;
  /** Two-step verification is set up and confirmed on their account. */
  accountEnrollmentEnabled: boolean;
  /**
   * Passkeys registered on their account. Information, not evidence: a
   * passkey satisfies the condition through the SIGN-IN that used it, so a
   * person who holds one and signed in with a password is still held. The
   * administrator sees the count so a held member reads as "sign in with the
   * passkey" rather than as a mystery.
   */
  passkeyCount: number;
  /** How they satisfy the requirement, or that they do not. */
  satisfaction: SecondFactorSatisfaction;
}

/** What this organization's identity provider asserts about its sign-ins. */
export interface OrganizationConnectionFactors {
  /** Whether the organization has a connection at all. */
  connected: boolean;
  /** The second factors the connection asserts, in the order it asserts them. */
  assertedFactors: readonly Amr[];
  /** Whether any of them is a second factor. */
  assertsSecondFactor: boolean;
}

export interface OrganizationMfaSettingPort {
  read(args: { organizationId: string }): Promise<{
    mfaRequired: boolean;
    name: string;
    slug: string;
  }>;
  write(args: { organizationId: string; mfaRequired: boolean }): Promise<void>;
}

export interface OrganizationMemberFactorPort {
  /** Everyone currently holding a seat, with what their account carries. */
  membersOf(args: { organizationId: string }): Promise<
    readonly {
      userId: string;
      name: string | null;
      email: string | null;
      accountEnrollmentEnabled: boolean;
      passkeyCount: number;
    }[]
  >;
  /** One person's account-level evidence. */
  accountFactorFor(args: { userId: string }): Promise<{
    accountEnrollmentEnabled: boolean;
    passkeyCount: number;
  }>;
  isMember(args: { userId: string; organizationId: string }): Promise<boolean>;
}

export interface OrganizationConnectionFactorPort {
  /**
   * The `amr` values this organization's connection asserts, or null when it
   * has no connection. Null and `[]` mean different things and the
   * administrator's screen says so: no connection at all, versus a connection
   * that is asserting nothing.
   */
  assertedFactorsFor(args: {
    organizationId: string;
  }): Promise<readonly string[] | null>;
}

/**
 * What the organization's members are told when the requirement starts to
 * apply to them. Injected so the mail is the app's business and this service
 * stays testable.
 */
export interface OrganizationMfaNotifier {
  requirementTurnedOn(args: {
    organizationId: string;
    actorUserId: string;
    /** Everyone the requirement now applies to — held or not. */
    memberUserIds: readonly string[];
  }): Promise<void>;
}

/**
 * What one session recorded it proved.
 *
 * A read, never a write. Nothing in this deliverable ends a session, and this
 * port has no method that could.
 */
export interface SessionFactorPort {
  amrFor(args: { sessionId: string }): Promise<readonly string[] | null>;
}

export interface OrganizationMfaServiceDeps {
  settings: OrganizationMfaSettingPort;
  sessions: SessionFactorPort;
  members: OrganizationMemberFactorPort;
  connections: OrganizationConnectionFactorPort;
  notifier: OrganizationMfaNotifier;
  /**
   * Whether this deployment offers two-step verification at all. A closure
   * rather than an env read inside the service, for the reason every other
   * seam here is one: nothing below the composition root reads env.
   */
  offered: () => boolean;
  /**
   * Whether this organization's plan carries the requirement. A port for the
   * same reason `offered` is a closure: nothing below the composition root
   * reads the subscription table or a license, and a service that had to
   * would be untestable against the states that matter.
   *
   * Deliberately per-organization rather than per-deployment. On Cloud the
   * answer is a subscription row; self-hosted it is the installation's
   * license. Both arrive here as one boolean.
   */
  entitled: (args: { organizationId: string }) => Promise<boolean>;
}

/** Where a member stands with one organization. */
export interface OrganizationMfaStanding {
  organizationId: string;
  /**
   * Null for a caller who is not a member.
   *
   * The name is the one identifying thing this answer carries, and the
   * procedure asking for it holds no permission on the organization named —
   * so it has to be absent for a stranger, or the endpoint is a directory of
   * every tenant's display name keyed by id.
   */
  organizationName: string | null;
  /** Whether this organization asks for a second factor at all. */
  required: boolean;
  satisfaction: SecondFactorSatisfaction;
  /** Whether the person holds a passkey they could sign in with instead. */
  holdsPasskey: boolean;
}

export class OrganizationMfaService {
  constructor(private readonly deps: OrganizationMfaServiceDeps) {}

  /**
   * Where one member stands with one organization, on the session they are
   * holding right now.
   *
   * `amr` is what THAT session recorded it proved. Null is a first-class
   * value: every session minted before this shipped is one, and reading it as
   * an error would end sessions the deliverable promised never to touch.
   */
  async standingFor({
    userId,
    organizationId,
    amr,
  }: {
    userId: string;
    organizationId: string;
    amr: readonly string[] | null;
  }): Promise<OrganizationMfaStanding> {
    // MEMBERSHIP FIRST, and it is a tenancy boundary rather than an
    // optimisation. `standing` is a `.noPermission()` procedure taking a
    // caller-supplied `organizationId` — there is no scope to hold a
    // permission on, because the caller is asking about an organization they
    // may not be in. So a stranger asking about somebody else's organization
    // used to be answered with that organization's NAME, and an id that does
    // not exist threw instead: a clean existence oracle over every tenant.
    //
    // A non-member gets the shape a member with nothing set up gets, which is
    // what this procedure's own `reason` string always claimed it gave them.
    if (!(await this.deps.members.isMember({ userId, organizationId }))) {
      return {
        organizationId,
        organizationName: null,
        required: false,
        satisfaction: satisfiesOrganizationMfaRequirement({
          mfaRequired: false,
          evidence: { accountEnrollmentEnabled: false, amr },
        }),
        holdsPasskey: false,
      };
    }

    const organization = await this.deps.settings.read({ organizationId });
    // With the flag off nothing is asked for that was not asked for before,
    // including this. An organization that turned the requirement on before
    // the flag went off keeps the column; it simply stops holding anybody.
    const required = this.deps.offered() && organization.mfaRequired;
    const account = await this.deps.members.accountFactorFor({ userId });
    return {
      organizationId,
      organizationName: organization.name,
      required,
      satisfaction: satisfiesOrganizationMfaRequirement({
        mfaRequired: required,
        evidence: {
          accountEnrollmentEnabled: account.accountEnrollmentEnabled,
          amr,
        },
      }),
      holdsPasskey: account.passkeyCount > 0,
    };
  }

  /**
   * The same question, asked by a request rather than by a test: the session
   * supplies its own evidence.
   *
   * A session id we cannot resolve reads as a session that recorded nothing,
   * which is the same first-class value a pre-D06 session carries. It is not
   * an error and it ends nothing.
   */
  async standingForSession({
    userId,
    organizationId,
    sessionId,
  }: {
    userId: string;
    organizationId: string;
    sessionId: string | undefined;
  }): Promise<OrganizationMfaStanding> {
    const amr = sessionId
      ? await this.deps.sessions.amrFor({ sessionId })
      : null;
    return this.standingFor({ userId, organizationId, amr });
  }

  /**
   * The gate, as a refusal. Throws where the member cannot prove one, so the
   * screen renders the registered copy for `identity_mfa_enrollment_required`
   * rather than an unknown error, and returns quietly everywhere else.
   *
   * Nothing here ends a session, and nothing here touches any organization
   * but the one asked about.
   */
  async assertSatisfied({
    userId,
    organizationId,
    amr,
  }: {
    userId: string;
    organizationId: string;
    amr: readonly string[] | null;
  }): Promise<void> {
    const standing = await this.standingFor({ userId, organizationId, amr });
    if (standing.satisfaction.satisfied) return;
    throw new IdentityMfaEnrollmentRequiredError(
      `organization ${organizationId} requires a second factor and ${userId} cannot yet prove one`,
    );
  }

  /** What this organization has set, for the administrator's screen. */
  async readRequirement({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{
    mfaRequired: boolean;
    offered: boolean;
    connection: OrganizationConnectionFactors;
  }> {
    const [organization, connection] = await Promise.all([
      this.deps.settings.read({ organizationId }),
      this.connectionFactors({ organizationId }),
    ]);
    return {
      mfaRequired: organization.mfaRequired,
      offered: this.deps.offered(),
      connection,
    };
  }

  /**
   * Turn the requirement on or off.
   *
   * Turning it ON ends no session, and there is no session port here to end
   * one with. Turning it OFF releases every held member on the session they
   * are already holding, which needs no write of its own: the condition is
   * evaluated on the way in, so the next request through the gate simply
   * passes.
   *
   * Turning it ON is the paid move, and the plan is asked HERE. The screen
   * greys the control out for an organization that cannot have it, but a
   * greyed control is a courtesy to whoever is reading rather than a
   * boundary — a second tab, a stale page or a script reaches this method
   * with the switch never rendered.
   *
   * Turning it OFF asks no plan at all, in either direction. An organization
   * whose plan lapses with the requirement already on has members standing
   * at an enrollment gate, and an administrator who could not release them
   * would have bought a lockout.
   */
  async setRequirement({
    organizationId,
    mfaRequired,
    actorUserId,
  }: {
    organizationId: string;
    mfaRequired: boolean;
    actorUserId: string;
  }): Promise<{ previous: boolean; next: boolean }> {
    if (!this.deps.offered()) {
      // Nothing offers a setup on this deployment, so a requirement would
      // hold every member at a gate with no way through it.
      throw new IdentityMfaEnrollmentRequiredError(
        `organization ${organizationId} cannot require a second factor while two-step verification is not offered here`,
      );
    }
    const current = await this.deps.settings.read({ organizationId });
    if (current.mfaRequired === mfaRequired) {
      return { previous: current.mfaRequired, next: mfaRequired };
    }
    // Asked only for the change that turns it ON, and only once the setting
    // is known to be actually changing: a plan lookup on the way out would
    // be a bill for standing still.
    if (mfaRequired && !(await this.deps.entitled({ organizationId }))) {
      throw new IdentityMfaRequirementNotLicensedError(
        `organization ${organizationId} asked to require a second factor on a plan that does not carry the requirement`,
      );
    }
    await this.deps.settings.write({ organizationId, mfaRequired });
    if (mfaRequired) {
      const members = await this.deps.members.membersOf({ organizationId });
      await this.deps.notifier.requirementTurnedOn({
        organizationId,
        actorUserId,
        memberUserIds: members.map((member) => member.userId),
      });
    }
    return { previous: current.mfaRequired, next: mfaRequired };
  }

  /**
   * Who can prove one and who cannot, for the administrator's member list.
   *
   * Evaluated against the ACCOUNT rather than against anybody's live session:
   * an administrator reading their member list is not holding their members'
   * sessions, and a list that changed as people signed in and out would be
   * unreadable. A member whose only factor rides a sign-in therefore reads as
   * unable here, with the passkey count beside them saying why.
   *
   * Asked as though the requirement were ON, whatever the organization has
   * set. That is the whole use of this list: an administrator about to turn
   * it on needs to see who it would hold BEFORE they throw the switch, and a
   * list that answered "everybody is fine" until the moment it mattered would
   * be worse than no list.
   */
  async memberFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly OrganizationMemberFactor[]> {
    const members = await this.deps.members.membersOf({ organizationId });
    return members.map((member) => ({
      ...member,
      satisfaction: satisfiesOrganizationMfaRequirement({
        mfaRequired: true,
        evidence: {
          accountEnrollmentEnabled: member.accountEnrollmentEnabled,
          amr: null,
        },
      }),
    }));
  }

  /** What the organization's connection asserts, if it has one. */
  private async connectionFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationConnectionFactors> {
    const asserted = await this.deps.connections.assertedFactorsFor({
      organizationId,
    });
    if (asserted === null) {
      return {
        connected: false,
        assertedFactors: [],
        assertsSecondFactor: false,
      };
    }
    return {
      connected: true,
      // Unrecognized values are dropped from what we REPORT and still count
      // for nothing in the decision: `connectionAssertsSecondFactor` owns the
      // rule that nothing infers a factor a provider did not assert.
      assertedFactors: asserted.filter(isAmr),
      assertsSecondFactor: connectionAssertsSecondFactor(asserted),
    };
  }
}
