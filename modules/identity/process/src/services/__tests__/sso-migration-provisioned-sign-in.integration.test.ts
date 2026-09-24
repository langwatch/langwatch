/**
 * @vitest-environment node
 * A member a directory sync provisioned never verified their address. The update's
 * link policy lets them through on the replacement's proof, and counts only the
 * accounts holding their exact address. Spec: specs/identity/sso-idp-termination.feature.
 */
import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaIdentityUsersRepository } from "../../repositories/prisma/prisma.identity-users.repository.ts";
import { PrismaSsoMigrationEvidenceRepository } from "../../repositories/prisma/prisma.sso-migration-evidence.repository.ts";
import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { SsoMigrationCallbackService } from "../sso-migration-callback.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `ssoprov${nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x")}`;
const domain = `${namespace}.test`;
const ORGANIZATION_ID = `${namespace}-org`;
const REPLACEMENT_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const LEGACY_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW999zz";
const provisionedId = `${namespace}-sam`;
const underscoredId = `${namespace}-k_m`;
const lookalikeId = `${namespace}-kxm`;
const email = (userId: string) => `${userId}@${domain}`;

const PROOF: SsoDomainVerification = {
  domain,
  method: "dns-txt",
  actorId: null,
  verifiedAtMs: 1_756_000_000_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

function connection(over: Partial<SsoConnectionState>): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: over.connectionId ?? REPLACEMENT_ID });
  return {
    ...base,
    organizationId: ORGANIZATION_ID,
    state: "ACTIVE",
    verifiedDomains: [domain],
    domainVerifications: [PROOF],
    ...over,
    idpMetadata: { ...base.idpMetadata, ...over.idpMetadata },
  };
}

const idp = (providerId: string) => ({
  providerId,
  issuer: null,
  clientIdRef: null,
  secretRef: null,
  certRefs: [],
});

const PAIR = [
  connection({
    connectionId: REPLACEMENT_ID,
    source: "self-serve",
    replacesConnectionId: LEGACY_ID,
    migrationPhase: "GRACE_LEGACY",
    idpMetadata: idp("acme-idp"),
  }),
  connection({
    connectionId: LEGACY_ID,
    source: "legacy-grandfathered",
    domainVerifications: [{ ...PROOF, method: "legacy-configuration", tokenHash: null }],
    idpMetadata: idp("auth0"),
  }),
];

/** The pair as the policy reads it; only the address half comes from the database. */
class PairReads extends SsoConnectionReadRepository {
  async tryFindConnection(): Promise<SsoConnectionState | null> {
    throw new Error("the callback policy never reads one connection by id");
  }

  async tryFindDomainOwner() {
    return { connectionId: REPLACEMENT_ID, organizationId: ORGANIZATION_ID };
  }

  async findForOrganization() {
    return PAIR;
  }
}

describe.skipIf(!DB_URL)("a directory-provisioned member signing in mid-update", () => {
  const connectionToDatabase = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:sso-provisioned-sign-in"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connectionToDatabase.client;
  const policy = SsoMigrationCallbackService.create({
    connections: new PairReads(),
    users: PrismaIdentityUsersRepository.create(prisma),
    memberships: { organizationIdsForMember: async () => [ORGANIZATION_ID] },
    trail: { record: async () => undefined },
  });
  const decide = (userId: string) =>
    policy.decideAccountLink({
      userId,
      account: { providerId: "auth0", accountId: `sub-${userId}` },
      otherAccounts: [],
    });

  beforeAll(async () => {
    for (const id of [provisionedId, underscoredId, lookalikeId]) {
      await prisma.user.create({ data: { id, name: id, email: email(id) } });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [provisionedId, underscoredId, lookalikeId] } },
    });
    await prisma.$disconnect();
  });

  describe("when a member whose address was never verified signs in", () => {
    /** @scenario "A person the previous connection's sync provisioned can sign in through the replacement before the update finishes" */
    it("is let through the update's link policy on the replacement's proof", async () => {
      await expect(decide(provisionedId)).resolves.toMatchObject({
        kind: "allow_replacement_pair",
      });
    });
  });

  describe("when their address holds a character a pattern match would treat as a wildcard", () => {
    /** @scenario "The new connection recognises members by address on a domain it proved, confirmed or not" */
    it("counts only the accounts holding that exact address, the way the progress page does", async () => {
      await expect(decide(underscoredId)).resolves.toMatchObject({
        kind: "allow_replacement_pair",
      });

      const holders = await PrismaSsoMigrationEvidenceRepository.create(prisma, () =>
        nanoid(),
      ).countAddressHolders({ addresses: [email(underscoredId).toUpperCase()] });
      expect(holders.get(email(underscoredId).toLowerCase())).toBe(1);
    });
  });
});
