/** @vitest-environment node */

/**
 * The joining setting's boundary: who may change it, and what the change
 * leaves behind on the customer's audit page (D12).
 *
 * Both halves run the REAL declared-permission middleware over stubbed
 * resolvers, rather than reading the declaration back and calling that a
 * test. A declaration nobody enforces is exactly the failure the audit sweep
 * cannot see, so what is exercised here is the refusal itself.
 *
 * Spec: specs/identity/domain-auto-join.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasOrganizationPermission = vi.fn();
const auditLogMock = vi.fn(async () => undefined);
const setJoiningMock = vi.fn();
const verifiedEmailsOfMock = vi.fn();
const provenAddressesMock = vi.fn();
const findUserMock = vi.fn();
const findUsersMock = vi.fn();
const lookupMock = vi.fn();
const requestMock = vi.fn();
const admitMock = vi.fn();
const pendingForOrganizationMock = vi.fn();
const readJoiningMock = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: { user: { findUnique: findUserMock, findMany: findUsersMock } },
}));

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    return {
      ...actual,
      hasOrganizationPermission: (...args: unknown[]) =>
        hasOrganizationPermission(...args),
      organizationDenialReason: async () => undefined,
    };
  },
);

vi.mock("~/server/app-layer/app", async () => {
  const permissions = await import("~/test-utils/appPermissionsMock");
  return permissions.appPermissionsMock();
});

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLogMock(...(args as [])),
}));

vi.mock("~/server/app-layer/identity/runtime", () => ({
  // Read at module load by the better-auth request hooks on this router's
  // import graph (GAC-09). Locks nobody: these suites assert nothing about
  // lock-out, and a mock that omits the export fails the whole file at
  // collection rather than at an assertion.
  signInLockout: () => ({
    refuseIfLockedOut: async () => void 0,
    recordFailure: async () => void 0,
    recordSuccess: async () => void 0,
  }),
  // Read at module load by the better-auth plugin list, which is on this
  // router's import graph. Off so the passkey ceremony is not mounted: this
  // suite asserts nothing about it, and a mock that omits the export fails
  // the whole file at collection rather than at an assertion.
  deploymentOffersPasskeys: () => false,
  // Whether an address is governed by an organization's own connection, read
  // by the credential-route refusal on the same import graph. No address in
  // these suites is, so the honest inert answer is "no".
  addressRoutesToConnection: async () => false,
  clearSignUpConfirmationPending: async () => void 0,
  // better-auth reads these at module load; the values are irrelevant to
  // anything here — they only have to exist for the import graph to settle.
  BACKUP_CODE_COUNT: 10,
  deploymentIsFederationCapable: async () => false,
  identityBridgeCeremonies: () => ({}),
  identityCeremonies: () => ({}),
  identityStorageAdapter: () => () => ({}),
  resolveSignInMethodPolicy: async () => ({}),
  // ADR-129 slice 21a: index.ts now composes better-auth's secondary storage
  // from this factory, and reads it EAGERLY at module load.
  secondaryStorage: () => ({ configured: false, connection: () => null }),
  betterAuthInstance: () => ({ provide: () => undefined }),
  PASSWORD_HASH_ROUNDS: 10,
  passkeySignUp: () => ({}),
  ssoAssertion: () => ({}),
  ssoProvisionedUsers: () => ({}),
  databaseHooks: () => ({}),
  credentialSessions: () => ({}),
  sessionClaims: () => ({}),
  sessionCallbackEvidence: () => ({}),
  mfaCeremonies: () => ({}),
  identityEmail: () => ({ verifiedEmailsOf: verifiedEmailsOfMock }),
  provenAddresses: () => ({ addressesOf: provenAddressesMock }),
  joinRequestsService: () => ({
    setJoining: setJoiningMock,
    lookup: lookupMock,
    request: requestMock,
    joinAutomaticallyIfAdmitted: admitMock,
    pendingForOrganization: pendingForOrganizationMock,
    readJoining: readJoiningMock,
  }),
  // The second-factor gate runs after every permitted decision (D06). Nothing
  // here is about it, so it answers "satisfied" and gets out of the way.
  organizationMfa: () => ({
    standingForSession: async () => ({ satisfaction: { satisfied: true } }),
  }),
}));

const auditExemptions = await import("~/server/api/auditLogExemptions");
const { isAuditLogExempt, isSelfAudited } = auditExemptions;
const { createInnerTRPCContext } = await import("~/server/api/trpc");
const joinRequests = await import("../joinRequests");
const { JOIN_SETTING_AUDIT_ACTION, joinRequestsRouter } = joinRequests;

const caller = () =>
  joinRequestsRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_ana", name: "Ana", email: "ana@acme.com" },
        expires: "1",
      },
      permissionChecked: false,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  setJoiningMock.mockResolvedValue({
    previous: "request",
    next: "auto",
    previousDomains: [],
    nextDomains: ["acme.com"],
  });
  verifiedEmailsOfMock.mockResolvedValue(null);
  provenAddressesMock.mockResolvedValue([]);
  findUserMock.mockResolvedValue(null);
  findUsersMock.mockResolvedValue([]);
  lookupMock.mockResolvedValue({ outcome: "none" });
  requestMock.mockResolvedValue({ joinRequestId: "jreq_1", state: "PENDING" });
  admitMock.mockResolvedValue(null);
  pendingForOrganizationMock.mockResolvedValue([]);
  readJoiningMock.mockResolvedValue({
    domainJoin: "request",
    joinDomains: [],
    joinerRole: "MEMBER",
  });
});

describe("given a request made from the terminal", () => {
  describe("when the welcome screen asks to join on the device page's behalf", () => {
    /** @scenario A request made from the terminal lands as a Developer when approved */
    it("hands the origin to the service", async () => {
      provenAddressesMock.mockResolvedValue(["ana@acme.com"]);

      await caller().request({ organizationId: "org_acme", origin: "cli" });

      expect(requestMock).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_acme", origin: "cli" }),
      );
    });

    /** @scenario A request made on the web keeps the organisation's joiner seat */
    it("reads an older client that names no origin as a web one", async () => {
      provenAddressesMock.mockResolvedValue(["ana@acme.com"]);

      await caller().request({ organizationId: "org_acme" });

      expect(requestMock).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "web" }),
      );
    });

    /** @scenario The welcome screen honours an automatic door */
    it("hands the origin to the automatic door too", async () => {
      provenAddressesMock.mockResolvedValue(["ana@acme.com"]);

      await caller().admitAutomatically({ origin: "cli" });

      expect(admitMock).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "cli" }),
      );
    });
  });

  describe("when an administrator opens the pending list", () => {
    /** @scenario The pending list shows the seat each request will land as */
    it("shows a Developer seat for the terminal's request and the joiner seat for the web's", async () => {
      hasOrganizationPermission.mockResolvedValue(true);
      const waiting = {
        domain: "acme.com",
        createdAtMs: 1_700_000_000_000,
        expiresAtMs: null,
      };
      pendingForOrganizationMock.mockResolvedValue([
        {
          ...waiting,
          joinRequestId: "jreq_cli",
          userId: "user_sam",
          origin: "cli",
        },
        {
          ...waiting,
          joinRequestId: "jreq_web",
          userId: "user_dana",
          origin: "web",
        },
      ]);

      const pending = await caller().pending({ organizationId: "org_acme" });

      expect(
        pending.map(({ joinRequestId, seat }) => ({ joinRequestId, seat })),
      ).toEqual([
        { joinRequestId: "jreq_cli", seat: "DEVELOPER" },
        { joinRequestId: "jreq_web", seat: "MEMBER" },
      ]);
    });
  });
});

describe("given the addresses the caller has proven", () => {
  describe("when the list holds an address", () => {
    it("hands the first one to the lookup as the verified address", async () => {
      provenAddressesMock.mockResolvedValue(["ana@acme.com", "ana@other.com"]);

      await caller().lookup();

      expect(lookupMock).toHaveBeenCalledWith({
        userId: "user_ana",
        verifiedEmail: "ana@acme.com",
      });
    });
  });

  describe("when the list is empty", () => {
    it("passes a null verified address and reads the user row itself not at all", async () => {
      provenAddressesMock.mockResolvedValue([]);
      findUserMock.mockResolvedValue({
        email: "ana@acme.com",
        emailVerified: true,
      });

      await expect(caller().lookup()).resolves.toEqual({ outcome: "none" });

      expect(findUserMock).not.toHaveBeenCalled();
      expect(lookupMock).toHaveBeenCalledWith({
        userId: "user_ana",
        verifiedEmail: null,
      });
    });
  });
});

describe("given a member who cannot manage the organization", () => {
  describe("when they try to change the joining setting", () => {
    /** @scenario Changing the setting needs the authority that gates managing the organization */
    it("is refused, and the setting is never written", async () => {
      hasOrganizationPermission.mockResolvedValue(false);

      await expect(
        caller().setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(setJoiningMock).not.toHaveBeenCalled();
    });

    /** @scenario Changing the setting needs the authority that gates managing the organization */
    it("is refused on the same authority that gates inviting", async () => {
      hasOrganizationPermission.mockResolvedValue(false);

      await caller()
        .setJoining({
          organizationId: "org_acme",
          domainJoin: "off",
          domains: [],
        })
        .catch(() => undefined);

      // Deciding who may walk in is the same decision as deciding who is
      // asked in, so it is the same permission.
      expect(hasOrganizationPermission).toHaveBeenCalledWith(
        expect.anything(),
        "org_acme",
        "organization:manage",
      );
    });
  });
});

describe("given an administrator changing the joining setting", () => {
  describe("when the change is saved", () => {
    /** @scenario The setting change is itself audited */
    it("puts the change on the audit page with the actor and both values", async () => {
      hasOrganizationPermission.mockResolvedValue(true);

      await caller().setJoining({
        organizationId: "org_acme",
        domainJoin: "auto",
        domains: ["acme.com"],
      });

      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_ana",
          organizationId: "org_acme",
          action: JOIN_SETTING_AUDIT_ACTION,
          args: {
            from: "request",
            to: "auto",
            fromDomains: [],
            toDomains: ["acme.com"],
          },
        }),
      );
    });

    /** @scenario The setting change is itself audited */
    it("records it once, as the richer fact rather than the arguments", () => {
      // The generic mutation audit stands down for this path, because the
      // arguments carry only what the setting BECAME — and an administrator
      // reading the page months later needs what it was as well. Two rows for
      // one change would make the page harder to read, not more complete.
      expect(isAuditLogExempt("joinRequests.setJoining")).toBe(true);
      expect(isSelfAudited("joinRequests.setJoining")).toBe(true);
    });
  });
});
