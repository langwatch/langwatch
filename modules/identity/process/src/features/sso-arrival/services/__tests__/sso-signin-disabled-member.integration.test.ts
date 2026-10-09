/**
 * @vitest-environment node
 * A member whose membership was disabled before they sign in is refused by identity's
 * read of the committed membership. Spec: specs/identity/scim-sso-signin.feature.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
  type SsoUserResolutionInput,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaSsoRegistrantReadRepository } from "../../../sso-connection/repositories/prisma/prisma.sso-registrant.repository.ts";
import { SsoConnectionReadRepository } from "../../../sso-connection/repositories/sso-connection.repository.ts";
import { SsoUserResolutionService } from "../sso-user-resolution.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `ssodis${nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x")}`;
const domain = `${namespace}.test`;
const ORGANIZATION_ID = `${namespace}-org`;
const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const ISSUER = "https://idp.acme.test";
const userId = `${namespace}-sam`;
const email = `${userId}@${domain}`;

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

const CONNECTION: SsoConnectionState = {
  ...emptySsoConnection({ connectionId: CONNECTION_ID }),
  organizationId: ORGANIZATION_ID,
  state: "ACTIVE",
  verifiedDomains: [domain],
  domainVerifications: [PROOF],
};

class OneConnection extends SsoConnectionReadRepository {
  async getConnection(): Promise<SsoConnectionState> {
    return CONNECTION;
  }

  async getDomainOwner() {
    return { connectionId: CONNECTION_ID, organizationId: ORGANIZATION_ID };
  }

  async findForOrganization() {
    return [CONNECTION];
  }
}

const assertion: SsoUserResolutionInput = {
  protocol: "oidc",
  providerId: CONNECTION_ID,
  accountKey: { issuer: ISSUER, accountId: `sub-${userId}` },
  email,
  emailVerified: true,
  emailVerification: "verified",
};

describe.skipIf(!DB_URL)("a directory-provisioned member disabled before they sign in", () => {
  const database = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:sso-signin-disabled-member"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = database.client;
  /** The committed membership, written before the sign-in begins. */
  const committed = new Map<string, Date | null>();
  const service = SsoUserResolutionService.create({
    people: PrismaSsoRegistrantReadRepository.create(prisma),
    connections: new OneConnection(),
    directory: createApiFixture<ScimApi>({
      isDirectoryUserInactive: async () => false,
      findDirectoryConnectionsForUser: async () => [CONNECTION_ID],
    }),
    memberships: createApiFixture<OrganizationApi>({
      getMember: async ({ organizationId, userId: id }) => {
        if (!committed.has(id)) throw new MemberNotFoundError(id);
        return {
          userId: id,
          organizationId,
          role: "MEMBER",
          disabledAt: committed.get(id) ? nowInstant() : null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
          user: { id, name: "Sam", email },
          teams: [],
        };
      },
    }),
    proposals: { proposeLink: async () => [] },
    auditLog: createApiFixture<AuditLogApi>({
      record: async () => ({ id: "audit_1", occurredAt: 0 }),
    }),
    isHosted: false,
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, name: userId, email } });
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("when its verified provider signs them in", () => {
    /** @scenario "A member disabled before sign-in is refused and nothing is provisioned" */
    it("refuses the link on the committed disable and attaches no account", async () => {
      committed.set(userId, new Date());

      await expect(service.resolveUser(assertion)).resolves.toEqual({
        action: "reject",
        code: "OAuthAccountNotLinked",
      });
      expect(await prisma.account.count({ where: { userId } })).toBe(0);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    /** @scenario "A member disabled before sign-in is refused and nothing is provisioned" */
    it("refuses a membership that does not exist the same way", async () => {
      committed.delete(userId);

      await expect(service.resolveUser(assertion)).resolves.toEqual({
        action: "reject",
        code: "OAuthAccountNotLinked",
      });
      expect(await prisma.account.count({ where: { userId } })).toBe(0);
    });
  });
});
