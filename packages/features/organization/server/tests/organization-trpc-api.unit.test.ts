/**
 * @vitest-environment node
 *
 * The `organization.*` tRPC surface: the ordering rule that makes the policy
 * see a parsed input, the invitation-acceptance status guard, the
 * identifier-aware address match behind it, and the seat refusal a member
 * re-enable turns into the shape the client's limit modal opens off.
 *
 * The deeper invitation behaviour this surface used to be tested through —
 * the conditional ACCEPTED claim, the membership row committing before the
 * ledger grants — belongs to `InviteService` and is pinned by that service's
 * own suite. What is left here is what the transport itself decides.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  OrganizationTrpcApi,
  type OrganizationTrpcPorts,
} from "../src/transport/api-trpc/organization.api";
import {
  OrganizationApp,
  type OrganizationAppDependencies,
} from "../src/app/organization.app";

type TestContext = {
  app: { organizations: OrganizationApp };
  session: { user: { id: string; name?: string | null; email?: string | null } } | null;
};

/** The feature's application over a stub service, as the process builds it. */
function application(organizations: Record<string, unknown>): OrganizationApp {
  return OrganizationApp.create({
    organizations: organizations as unknown as OrganizationAppDependencies["organizations"],
    projects: {} as unknown as OrganizationAppDependencies["projects"],
  });
}

const INVITE = {
  id: "inv-1",
  email: "user@example.com",
  inviteCode: "test-code",
  status: "PENDING",
  expiration: new Date(Date.now() + 86_400_000),
  organizationId: "org-1",
  role: "MEMBER",
  organization: { id: "org-1", name: "Test Org" },
};

function invite(overrides: Record<string, unknown> = {}) {
  return { ...INVITE, ...overrides } as never;
}

/**
 * Every port stubbed to the answer that lets the golden path through, so each
 * test overrides only the one it is about.
 */
function stubPorts(overrides: Partial<OrganizationTrpcPorts> = {}) {
  const ports = {
    signUpDataSchema: z.object({ terms: z.boolean().optional() }),

    probeOrganizationPermission: vi.fn(async () => true),
    batchProjectPermissions: vi.fn(async () => new Map<string, boolean>()),
    listBindingsForSynthesis: vi.fn(async () => []),
    enrichTeamWithRoleBindings: vi.fn((team: unknown) => team),

    demoProject: () => ({ userId: "", projectId: "" }),
    decryptStoredSecret: (value: string) => `decrypted:${value}`,

    assertCustomRolesAllowed: vi.fn(async () => {}),
    assertAuditLogsAllowed: vi.fn(async () => {}),
    isCustomRole: (role: string) => role.startsWith("custom:"),

    fullMemberLimitMessage: "Cannot complete action: full member limit reached",
    liteMemberViewerOnlyMessage: "Lite Members may only hold the viewer role",
    asMemberSeatLimitReached: vi.fn(() => null),
    asResourceLimitExceeded: vi.fn(() => null),
    isOrganizationNotFound: vi.fn(() => false),
    notifyResourceLimitReached: vi.fn(async () => {}),
    isTeamRoleAllowedForOrganizationRole: vi.fn(() => true),
    assertTeamRoleChangeWithinSeatLimits: vi.fn(async () => {}),
    assertNoPersonalTeamScope: vi.fn(async () => {}),
    tryGetTeamOrganizationId: vi.fn(async () => "org-1"),
    tryGetOrganizationMemberRole: vi.fn(async () => null),

    createInvites: vi.fn(async () => ({ organization: { members: [] }, invites: [] })),
    revokeInvite: vi.fn(async () => {}),
    assertInviteSendAllowed: vi.fn(async () => {}),
    resendInvite: vi.fn(async () => ({ invite: invite(), emailNotSent: false })),
    buildInviteAcceptUrl: (code: string) => `https://example.test/invite/${code}`,
    listInvites: vi.fn(async () => []),
    tryGetInviteByCode: vi.fn(async () => invite()),
    resolveInviteDisplayStatus: vi.fn(() => "PENDING" as const),
    matchInviteToAcceptor: vi.fn(async () => ({ matches: true, viaIdentifierId: null })),
    maskInvitedAddress: (email: string) => `•••@${email.split("@")[1] ?? ""}`,
    applyInvite: vi.fn(async () => {}),
    findLandingProjectSlug: vi.fn(async () => null),
    inviteNotFoundError: () => new Error("Invitation not found"),
    inviteExpiredError: () => new Error("Invitation expired"),
    inviteWrongAccountError: (masked: string) => new Error(`Wrong account: ${masked}`),
    inviteAlreadyAcceptedMessage: "Invite was already accepted",
    inviteNotReadyMessage: "Invite is not ready to be accepted",

    resolveJoinRequestByInvitation: vi.fn(async () => {}),
    withdrawJoinRequestOnInvitationAccepted: vi.fn(async () => {}),
    tryFindUserIdByEmail: vi.fn(async () => null),

    trackServerEvent: vi.fn(),
    fireTeamMemberInvitedNurturing: vi.fn(),
    fireInviteAcceptedNurturing: vi.fn(),
    sendSlackSignupEvent: vi.fn(async () => {}),
    reportError: vi.fn(),
    ...overrides,
  };
  return ports as unknown as OrganizationTrpcPorts<z.ZodTypeAny> & typeof ports;
}

function harness({
  organizations = {},
  ports = stubPorts(),
  user = { id: "user-1", name: "Test User", email: "user@example.com" },
}: {
  organizations?: Record<string, unknown>;
  ports?: ReturnType<typeof stubPorts>;
  user?: { id: string; name?: string | null; email?: string | null };
} = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const router = OrganizationTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      policy: () => (procedure) => procedure,
      auditLogPolicy: (procedure) => procedure,
    },
    ports,
  );

  return {
    router,
    ports,
    caller: router.createCaller({
      app: { organizations: application(organizations) },
      session: { user },
    }),
  };
}

describe("OrganizationTrpcApi", () => {
  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware at the point `.input()`
     * is called, so anything installed before it runs with `input ===
     * undefined`. The process's real policy resolves the authorized scope id
     * FROM the input, which is why this feature applies the decorator after
     * its own parser. Installed the other way round, the authorization check,
     * the scope-lineage guard and the audit row would all see nothing and
     * every guard would still report green.
     */
    it("hands the policy the parsed input, not undefined", async () => {
      const seen: unknown[] = [];
      const trpc = initTRPC.context<TestContext>().create();
      const router = OrganizationTrpcApi.create(
        trpc,
        {
          protected: trpc.procedure,
          policy: () => (procedure) =>
            (procedure as { use(m: unknown): unknown }).use(
              ({ input, next }: { input: unknown; next: () => unknown }) => {
                seen.push(input);
                return next();
              },
            ) as typeof procedure,
          auditLogPolicy: (procedure) => procedure,
        },
        stubPorts(),
      );

      await router
        .createCaller({
          app: { organizations: application({ getAllMembers: async () => [] }) },
          session: { user: { id: "user-1" } },
        })
        .getAllOrganizationMembers({ organizationId: "org-1" });

      expect(seen).toEqual([{ organizationId: "org-1" }]);
    });
  });

  describe("when accepting an invitation", () => {
    describe("given the invitation is PENDING", () => {
      it("applies it and answers with the landing project", async () => {
        const ports = stubPorts({
          findLandingProjectSlug: vi.fn(async () => "acme-project"),
        });
        const { caller } = harness({
          organizations: { ensurePersonalWorkspace: vi.fn(async () => ({})) },
          ports,
        });

        const result = await caller.acceptInvite({ inviteCode: "test-code" });

        expect(result.success).toBe(true);
        expect(result.project).toEqual({ slug: "acme-project" });
        expect(ports.applyInvite).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ userId: "user-1", viaIdentifierId: null }),
        );
      });
    });

    describe("given the invitation was already accepted", () => {
      it("refuses with the already-accepted message", async () => {
        const ports = stubPorts({
          tryGetInviteByCode: vi.fn(async () => invite({ status: "ACCEPTED" })),
        });
        const { caller } = harness({ ports });

        await expect(caller.acceptInvite({ inviteCode: "test-code" })).rejects.toThrow(
          "Invite was already accepted",
        );
        expect(ports.applyInvite).not.toHaveBeenCalled();
      });
    });

    describe("given the invitation is neither PENDING nor ACCEPTED", () => {
      it("refuses with the not-ready message", async () => {
        const ports = stubPorts({
          tryGetInviteByCode: vi.fn(async () => invite({ status: "PAYMENT_PENDING" })),
          resolveInviteDisplayStatus: vi.fn(() => "PAYMENT_PENDING" as never),
        });
        const { caller } = harness({ ports });

        await expect(caller.acceptInvite({ inviteCode: "test-code" })).rejects.toThrow(
          "Invite is not ready to be accepted",
        );
        expect(ports.applyInvite).not.toHaveBeenCalled();
      });
    });

    /**
     * A revoked invitation reads exactly like a missing one: the journey ends
     * quietly, revealing nothing about the organization or the inviter.
     */
    describe("given the invitation was revoked", () => {
      it("answers the same way a missing one does", async () => {
        const ports = stubPorts({
          tryGetInviteByCode: vi.fn(async () => invite({ status: "REVOKED" })),
        });
        const { caller } = harness({ ports });

        await expect(caller.acceptInvite({ inviteCode: "test-code" })).rejects.toThrow(
          "Invitation not found",
        );
      });
    });

    describe("given the invitation has expired", () => {
      it("says so, because a resend recovers it in one click", async () => {
        const ports = stubPorts({
          resolveInviteDisplayStatus: vi.fn(() => "EXPIRED" as never),
        });
        const { caller } = harness({ ports });

        await expect(caller.acceptInvite({ inviteCode: "test-code" })).rejects.toThrow(
          "Invitation expired",
        );
        expect(ports.applyInvite).not.toHaveBeenCalled();
      });
    });

    describe("given the signed-in account holds none of the invited addresses", () => {
      it("names the wanted account masked, and applies nothing", async () => {
        const ports = stubPorts({
          matchInviteToAcceptor: vi.fn(async () => ({
            matches: false,
            viaIdentifierId: null,
          })),
        });
        const { caller } = harness({ ports });

        await expect(caller.acceptInvite({ inviteCode: "test-code" })).rejects.toThrow(
          "Wrong account: •••@example.com",
        );
        expect(ports.applyInvite).not.toHaveBeenCalled();
      });
    });

    describe("given a verified identifier vouches for the caller", () => {
      it("records which identifier the acceptance matched on", async () => {
        const ports = stubPorts({
          matchInviteToAcceptor: vi.fn(async () => ({
            matches: true,
            viaIdentifierId: "identifier-9",
          })),
        });
        const { caller } = harness({
          organizations: { ensurePersonalWorkspace: vi.fn(async () => ({})) },
          ports,
        });

        await caller.acceptInvite({ inviteCode: "test-code" });

        expect(ports.applyInvite).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ viaIdentifierId: "identifier-9" }),
        );
      });
    });

    /**
     * The personal workspace, the withdrawn join request and the signup
     * notification are all non-fatal: the membership is the durable outcome
     * and a failure in any of them must not cost the caller the organization
     * they just joined.
     */
    describe("given provisioning the personal workspace fails", () => {
      it("still accepts, and reports the failure", async () => {
        const ports = stubPorts();
        const { caller } = harness({
          organizations: {
            ensurePersonalWorkspace: vi.fn(async () => {
              throw new Error("provisioning is down");
            }),
          },
          ports,
        });

        const result = await caller.acceptInvite({ inviteCode: "test-code" });

        expect(result.success).toBe(true);
        expect(ports.reportError).toHaveBeenCalled();
      });
    });
  });

  describe("when disabling a member", () => {
    /**
     * The live browser sessions of a disabled member are revoked by the
     * membership write itself rather than here, so the REST surface and this
     * one revoke on one path instead of two.
     */
    it("delegates to the service with the acting user", async () => {
      const setMemberDisabled = vi.fn(async () => {});
      const { caller } = harness({ organizations: { setMemberDisabled } });

      await caller.setMemberDisabled({
        organizationId: "org-1",
        userId: "member-1",
        disabled: true,
      });

      expect(setMemberDisabled).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "member-1",
        disabled: true,
        actingUser: { id: "user-1", name: "Test User", email: "user@example.com" },
      });
    });

    describe("given the organization has no seat left to re-enable into", () => {
      /**
       * The same shape every other member-limit refusal throws, so the
       * client's global handler opens the limit modal with the real numbers
       * and its "Upgrade license" link rather than this route inventing copy.
       */
      it("refuses with the seat facts on the cause", async () => {
        const seatLimit = { limitType: "members", current: 5, max: 5 };
        const ports = stubPorts({
          asMemberSeatLimitReached: vi.fn(() => seatLimit),
        });
        const { caller } = harness({
          organizations: {
            setMemberDisabled: vi.fn(async () => {
              throw new Error("seat limit");
            }),
          },
          ports,
        });

        await expect(
          caller.setMemberDisabled({
            organizationId: "org-1",
            userId: "member-1",
            disabled: false,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: seatLimit,
        });
      });
    });

    describe("given the failure is not a seat limit", () => {
      it("lets it through untouched", async () => {
        const { caller } = harness({
          organizations: {
            setMemberDisabled: vi.fn(async () => {
              throw new Error("database is down");
            }),
          },
        });

        await expect(
          caller.setMemberDisabled({
            organizationId: "org-1",
            userId: "member-1",
            disabled: true,
          }),
        ).rejects.toThrow("database is down");
      });
    });
  });

  describe("when inviting members", () => {
    describe("given the organization is out of seats", () => {
      it("tells its administrators before refusing the caller", async () => {
        const ports = stubPorts({
          createInvites: vi.fn(async () => {
            throw new Error("limit");
          }),
          asResourceLimitExceeded: vi.fn(() => ({
            limitType: "members",
            current: 5,
            max: 5,
            message: "You have reached the maximum number of members",
          })),
        });
        const { caller } = harness({ ports });

        await expect(
          caller.createInvites({
            organizationId: "org-1",
            invites: [{ email: "new@example.com", role: "MEMBER" }],
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(ports.notifyResourceLimitReached).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ organizationId: "org-1", limitType: "members" }),
        );
      });
    });

    describe("given the invitation names a custom team role", () => {
      it("checks the Enterprise plan before writing anything", async () => {
        const ports = stubPorts();
        const { caller } = harness({ ports });

        await caller.createInvites({
          organizationId: "org-1",
          invites: [
            {
              email: "new@example.com",
              role: "MEMBER",
              teams: [{ teamId: "team-1", role: "custom:role-1", customRoleId: "role-1" }],
            },
          ],
        });

        expect(ports.assertCustomRolesAllowed).toHaveBeenCalledWith(expect.anything(), {
          organizationId: "org-1",
        });
      });
    });
  });

  describe("when reading the audit trail", () => {
    it("checks the Enterprise plan before the query runs", async () => {
      const getAuditLogs = vi.fn(async () => ({ auditLogs: [], totalCount: 0 }));
      const ports = stubPorts({
        assertAuditLogsAllowed: vi.fn(async () => {
          throw new Error("audit logs are an Enterprise capability");
        }),
      });
      const { caller } = harness({ organizations: { getAuditLogs }, ports });

      await expect(caller.getAuditLogs({ organizationId: "org-1" })).rejects.toThrow(
        "audit logs are an Enterprise capability",
      );
      expect(getAuditLogs).not.toHaveBeenCalled();
    });
  });
});
