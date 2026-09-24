/**
 * @vitest-environment node
 * Which connection a callback belongs to while an organization cuts over, and
 * when the grandfathered side stops authenticating anybody (ADR-117 §6).
 */
import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoConnectionNotFoundError,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { inMemoryIdentityUsers } from "../../testing.ts";
import { SsoMigrationCallbackService } from "../sso-migration-callback.service.ts";

const ORGANIZATION_ID = "org_acme";
const USER_ID = "user_sam";
const REPLACEMENT_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const LEGACY_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW999zz";

const PROOF: SsoDomainVerification = {
  domain: "acme.com",
  method: "dns-txt",
  actorId: null,
  verifiedAtMs: 1_756_000_000_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

const LEGACY_PROOF: SsoDomainVerification = {
  ...PROOF,
  method: "legacy-configuration",
  tokenHash: null,
};

function connection(over: Partial<SsoConnectionState>): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: over.connectionId ?? REPLACEMENT_ID });
  return {
    ...base,
    organizationId: ORGANIZATION_ID,
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
    domainVerifications: [PROOF],
    ...over,
    idpMetadata: { ...base.idpMetadata, ...over.idpMetadata },
  };
}

const replacement = (phase: SsoConnectionState["migrationPhase"]): SsoConnectionState =>
  connection({
    connectionId: REPLACEMENT_ID,
    source: "self-serve",
    replacesConnectionId: LEGACY_ID,
    migrationPhase: phase,
    idpMetadata: {
      providerId: "acme-idp",
      issuer: null,
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
  });

const legacy = (): SsoConnectionState =>
  connection({
    connectionId: LEGACY_ID,
    source: "legacy-grandfathered",
    domainVerifications: [LEGACY_PROOF],
    idpMetadata: {
      providerId: "auth0",
      issuer: null,
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
  });

/** The connection log, as the policy reads it: by organization, and by who
 *  proved the domain. */
class Connections extends SsoConnectionReadRepository {
  constructor(private readonly rows: readonly SsoConnectionState[]) {
    super();
  }

  async getConnection(): Promise<SsoConnectionState> {
    throw new Error("the callback policy never reads one connection by id");
  }

  async getDomainOwner({ domain }: { domain: string }) {
    const owner = this.rows.find(
      (row) => row.state === "ACTIVE" && row.verifiedDomains.includes(domain),
    );
    if (!owner) throw new SsoConnectionNotFoundError(domain);
    return { connectionId: owner.connectionId, organizationId: owner.organizationId };
  }

  async findForOrganization({ organizationId }: { organizationId: string }) {
    return this.rows.filter((row) => row.organizationId === organizationId);
  }
}

interface TrailEntry {
  connectionId: string;
  userId: string;
  providerAccountId?: string | null;
}

function recordingTrail() {
  const recorded: TrailEntry[] = [];
  return {
    recorded,
    trail: {
      record: async (entry: TrailEntry) => {
        recorded.push(entry);
      },
    },
  };
}

function serviceOver({
  rows,
  organizations = [ORGANIZATION_ID],
  emails = { [USER_ID]: "sam@acme.com" },
  unverified = [] as readonly string[],
  trail = recordingTrail().trail,
}: {
  rows: readonly SsoConnectionState[];
  organizations?: string[];
  emails?: Record<string, string>;
  unverified?: readonly string[];
  trail?: { record: (entry: TrailEntry) => Promise<void> };
}) {
  return SsoMigrationCallbackService.create({
    connections: new Connections(rows),
    users: inMemoryIdentityUsers({ emails, unverified }),
    memberships: { organizationIdsForMember: async () => organizations },
    trail,
  });
}

const decide = (
  service: SsoMigrationCallbackService,
  account: { providerId: string; accountId: string },
  otherAccounts: { providerId: string; accountId: string }[] = [],
) => service.decideAccountLink({ userId: USER_ID, account, otherAccounts });

describe("given an organization that is not cutting over", () => {
  it("has nothing to say about an ordinary federated account", async () => {
    const service = serviceOver({ rows: [connection({ source: "self-serve" })] });

    await expect(decide(service, { providerId: "google", accountId: "sub-1" })).resolves.toEqual({
      kind: "not_migrating",
    });
  });

  it("names the grandfathered connection the domain and provider both point at", async () => {
    const service = serviceOver({ rows: [legacy()] });

    await expect(decide(service, { providerId: "auth0", accountId: "sub-1" })).resolves.toEqual({
      kind: "allow_connection",
      arrivalConnectionId: LEGACY_ID,
    });
  });
});

describe("given a pair mid-cutover", () => {
  it("names the replacement for a callback that arrived through it", async () => {
    const service = serviceOver({ rows: [replacement("GRACE_DIRECT"), legacy()] });

    await expect(
      decide(service, { providerId: REPLACEMENT_ID, accountId: "sub-new" }),
    ).resolves.toEqual({
      kind: "allow_replacement_pair",
      arrivalConnectionId: REPLACEMENT_ID,
    });
  });

  it("names the legacy side for a callback that arrived through the old provider", async () => {
    const service = serviceOver({ rows: [replacement("GRACE_LEGACY"), legacy()] });

    await expect(decide(service, { providerId: "auth0", accountId: "sub-old" })).resolves.toEqual({
      kind: "allow_replacement_pair",
      arrivalConnectionId: LEGACY_ID,
    });
  });

  it("refuses an address the replacement has not proved", async () => {
    const service = serviceOver({
      rows: [replacement("GRACE_LEGACY"), legacy()],
      emails: { [USER_ID]: "sam@elsewhere.test" },
    });

    await expect(decide(service, { providerId: "auth0", accountId: "sub-old" })).resolves.toEqual({
      kind: "reject",
      code: "SSO_MIGRATION_LINK_NOT_ALLOWED",
    });
  });

  it("refuses an address the identity provider has not verified", async () => {
    const service = serviceOver({
      rows: [replacement("GRACE_LEGACY"), legacy()],
      unverified: [USER_ID],
    });

    await expect(decide(service, { providerId: "auth0", accountId: "sub-old" })).resolves.toEqual({
      kind: "reject",
      code: "SSO_MIGRATION_LINK_UNVERIFIED",
    });
  });

  it("refuses an address more than one person holds", async () => {
    const service = serviceOver({
      rows: [replacement("GRACE_LEGACY"), legacy()],
      emails: { [USER_ID]: "sam@acme.com", user_other: "SAM@acme.com" },
    });

    await expect(decide(service, { providerId: "auth0", accountId: "sub-old" })).resolves.toEqual({
      kind: "reject",
      code: "SSO_MIGRATION_LINK_AMBIGUOUS",
    });
  });

  it("refuses a third identity on the pair, which cannot be ordered", async () => {
    const service = serviceOver({ rows: [replacement("GRACE_LEGACY"), legacy()] });

    await expect(
      decide(service, { providerId: "auth0", accountId: "sub-old" }, [
        { providerId: REPLACEMENT_ID, accountId: "sub-new" },
        { providerId: "auth0", accountId: "sub-older" },
      ]),
    ).resolves.toEqual({ kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" });
  });
});

describe("given the cutover has been finalized", () => {
  it.each(["FINALIZING", "FINALIZED"] as const)(
    "refuses the retired legacy callback in %s",
    async (phase) => {
      const service = serviceOver({ rows: [replacement(phase), legacy()] });

      await expect(decide(service, { providerId: "auth0", accountId: "sub-old" })).resolves.toEqual(
        { kind: "reject", code: "SSO_LEGACY_AUTH_RETIRED" },
      );
    },
  );

  it("still lets the replacement's own callback through", async () => {
    const service = serviceOver({ rows: [replacement("FINALIZED"), legacy()] });

    await expect(
      decide(service, { providerId: REPLACEMENT_ID, accountId: "sub-new" }),
    ).resolves.toEqual({
      kind: "allow_replacement_pair",
      arrivalConnectionId: REPLACEMENT_ID,
    });
  });
});

describe("given a session about to be minted from a callback", () => {
  const authorize = (
    service: SsoMigrationCallbackService,
    callbackPath: string | undefined,
    accounts: { providerId: string; accountId: string }[],
  ) => service.authorizeAndRecordAuthentication({ userId: USER_ID, callbackPath, accounts });

  it("has nothing to say about a sign-in that arrived through no callback", async () => {
    const { recorded, trail } = recordingTrail();
    const service = serviceOver({ rows: [replacement("GRACE_LEGACY"), legacy()], trail });

    await expect(authorize(service, "/sign-in/email", [])).resolves.toEqual({
      action: "continue",
    });
    expect(recorded).toEqual([]);
  });

  it("records the legacy sign-in against the connection it arrived through", async () => {
    const { recorded, trail } = recordingTrail();
    const service = serviceOver({ rows: [replacement("GRACE_LEGACY"), legacy()], trail });

    await expect(
      authorize(service, "/callback/auth0", [{ providerId: "auth0", accountId: "sub-old" }]),
    ).resolves.toEqual({ action: "continue" });
    expect(recorded).toEqual([
      { connectionId: LEGACY_ID, userId: USER_ID, providerAccountId: "sub-old" },
    ]);
  });

  it("records the replacement's own callback against the replacement", async () => {
    const { recorded, trail } = recordingTrail();
    const service = serviceOver({ rows: [replacement("GRACE_DIRECT"), legacy()], trail });

    await expect(
      authorize(service, `/sso/callback/${REPLACEMENT_ID}`, [
        { providerId: REPLACEMENT_ID, accountId: "sub-new" },
      ]),
    ).resolves.toEqual({ action: "continue" });
    expect(recorded).toEqual([
      { connectionId: REPLACEMENT_ID, userId: USER_ID, providerAccountId: "sub-new" },
    ]);
  });

  it.each(["FINALIZING", "FINALIZED"] as const)(
    "refuses a member who is still linked to the retired legacy side in %s",
    async (phase) => {
      const { recorded, trail } = recordingTrail();
      const service = serviceOver({ rows: [replacement(phase), legacy()], trail });

      await expect(
        authorize(service, "/callback/auth0", [{ providerId: "auth0", accountId: "sub-old" }]),
      ).resolves.toEqual({ action: "reject", code: "SSO_LEGACY_AUTH_RETIRED" });
      expect(recorded).toEqual([]);
    },
  );

  it("refuses a connection's own door presented by somebody bound to neither side", async () => {
    const { recorded, trail } = recordingTrail();
    const service = serviceOver({ rows: [replacement("GRACE_DIRECT"), legacy()], trail });

    await expect(
      authorize(service, `/sso/callback/${REPLACEMENT_ID}`, [
        { providerId: "google", accountId: "sub-else" },
      ]),
    ).resolves.toEqual({ action: "reject", code: "SSO_MIGRATION_AUTH_NOT_ALLOWED" });
    expect(recorded).toEqual([]);
  });

  it("has nothing to say where the organization is running no cutover", async () => {
    const { recorded, trail } = recordingTrail();
    const service = serviceOver({ rows: [legacy()], trail });

    await expect(
      authorize(service, "/callback/auth0", [{ providerId: "auth0", accountId: "sub-old" }]),
    ).resolves.toEqual({ action: "continue" });
    expect(recorded).toEqual([]);
  });
});
