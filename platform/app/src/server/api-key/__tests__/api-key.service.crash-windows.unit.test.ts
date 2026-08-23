/**
 * The windows a de-transactioned write leaves open (ADR-092 delivery-plan
 * PR 2).
 *
 * A key's row is a Prisma insert and its grants are ledger commands, so no
 * transaction can hold the two together. Ordering is the only fail-safety
 * left, and these cases pin the direction it fails in: a create that dies
 * halfway leaves an inert credential, and a replace that dies halfway leaves
 * the grants the key already had — never a live credential holding nothing,
 * which is the shape the read-through mint used to read as "legacy".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyService } from "../api-key.service";

vi.mock("../api-key-token.utils", () => ({
  generateApiKeyToken: () => ({
    token: "sk-lw-testlookup1234_testsecret",
    lookupId: "testlookup1234",
    hashedSecret: "hashedsecret123",
  }),
  splitApiKeyToken: vi.fn(),
  verifySecret: vi.fn(),
  hashSecret: vi.fn(),
  INGEST_KEY_PREFIX: "ik-lw-",
}));

vi.mock("~/server/rbac/role-binding-resolver", () => ({
  checkRoleBindingPermission: () => Promise.resolve(true),
  resolveLegacyCeiling: () => ({ grants: () => true }),
  resolveApiKeyPermission: () => Promise.resolve(true),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ authzGrants: ledger }),
  tryGetApp: () => null,
}));

const ORG_ID = "org_1";
const USER_ID = "user_1";
const KEY_ID = "ak_new";

const existingKey = {
  id: "ak_existing",
  name: "Existing Key",
  userId: USER_ID,
  organizationId: ORG_ID,
  permissionMode: "all",
  revokedAt: null,
  roleBindings: [
    {
      id: "rb_old",
      customRoleId: null,
      role: "ADMIN",
      scopeType: "ORGANIZATION",
      scopeId: ORG_ID,
    },
  ],
};

function buildPrisma() {
  return {
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ userId: USER_ID }),
    },
    apiKey: {
      findFirst: vi.fn(),
      create: vi.fn().mockImplementation((args: any) => ({
        id: KEY_ID,
        ...args.data,
        createdAt: new Date(),
      })),
      findUnique: vi.fn().mockResolvedValue(existingKey),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation((args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    teamUser: { count: vi.fn().mockResolvedValue(0) },
    customRole: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    team: { findFirst: vi.fn(), findUnique: vi.fn() },
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    organization: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  } as any;
}

/** The `activate` call: the one update that makes the credential usable. */
const activationsOf = (prisma: any) =>
  prisma.apiKey.update.mock.calls.filter(
    (call: any[]) => call[0]?.data?.revokedAt === null,
  );

describe("ApiKeyService — the crash windows around a grant write", () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: ApiKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = buildPrisma();
    service = ApiKeyService.create(prisma);
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindingsWhere.mockResolvedValue(0);
  });

  describe("given a create whose grants are still being written", () => {
    it("writes the key row revoked, so the token cannot authenticate yet", async () => {
      await service.create({
        name: "Automation Key",
        userId: null,
        organizationId: ORG_ID,
        permissionMode: "all",
        bindings: [
          { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
        ],
      });

      expect(
        prisma.apiKey.create.mock.calls[0]![0].data.revokedAt,
      ).toBeInstanceOf(Date);
      expect(prisma.apiKey.create).toHaveBeenCalledBefore(
        ledger.attachBindings,
      );
    });

    it("activates the key only after the grants are facts", async () => {
      const { apiKey } = await service.create({
        name: "Automation Key",
        userId: null,
        organizationId: ORG_ID,
        permissionMode: "all",
        bindings: [
          { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
        ],
      });

      expect(ledger.attachBindings).toHaveBeenCalledBefore(
        prisma.apiKey.update,
      );
      expect(activationsOf(prisma)).toHaveLength(1);
      expect(apiKey.revokedAt).toBeNull();
    });
  });

  describe("when the ledger refuses the new key's grants", () => {
    it("leaves the credential revoked rather than live with no grants", async () => {
      ledger.attachBindings.mockRejectedValueOnce(new Error("queue down"));

      await expect(
        service.create({
          name: "Automation Key",
          userId: null,
          organizationId: ORG_ID,
          permissionMode: "all",
          bindings: [
            { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        }),
      ).rejects.toThrow("queue down");

      expect(
        prisma.apiKey.create.mock.calls[0]![0].data.revokedAt,
      ).toBeInstanceOf(Date);
      expect(activationsOf(prisma)).toHaveLength(0);
    });
  });

  describe("given a replace of an existing key's grants", () => {
    it("attaches the new grants before revoking anything", async () => {
      ledger.attachBindings.mockResolvedValue({
        attached: ["rb_new"],
        duplicates: [],
      });

      await service.update({
        id: "ak_existing",
        callerUserId: USER_ID,
        callerIsAdmin: true,
        organizationId: ORG_ID,
        bindings: [
          { role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG_ID },
        ],
      });

      expect(ledger.attachBindings).toHaveBeenCalledBefore(
        ledger.revokeBindingsWhere,
      );
    });

    it("spares the grants it just wrote, and the identical ones already there", async () => {
      ledger.attachBindings.mockResolvedValue({
        attached: ["rb_new"],
        duplicates: ["rb_identical"],
      });

      await service.update({
        id: "ak_existing",
        callerUserId: USER_ID,
        callerIsAdmin: true,
        organizationId: ORG_ID,
        bindings: [
          { role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG_ID },
        ],
      });

      expect(ledger.revokeBindingsWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            apiKeyId: "ak_existing",
            id: { notIn: ["rb_new", "rb_identical"] },
          },
        }),
      );
    });
  });

  describe("when the ledger refuses the replacement grants", () => {
    it("revokes nothing, so the key keeps the access it already had", async () => {
      ledger.attachBindings.mockRejectedValueOnce(new Error("queue down"));

      await expect(
        service.update({
          id: "ak_existing",
          callerUserId: USER_ID,
          callerIsAdmin: true,
          organizationId: ORG_ID,
          bindings: [
            { role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        }),
      ).rejects.toThrow("queue down");

      expect(ledger.revokeBindingsWhere).not.toHaveBeenCalled();
    });
  });
});
