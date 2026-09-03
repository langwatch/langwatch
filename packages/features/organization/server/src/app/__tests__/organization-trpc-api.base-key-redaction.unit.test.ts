/**
 * @vitest-environment node
 *
 * @see specs/api-keys/project-key-read-access.feature
 *
 * The project base key travels inside the `organization.getAll` payload the
 * app loads on every page, so gating the endpoints that return it is only
 * half the job — what the session already holds has to be gated too.
 *
 * Moved from the platform application's `appRouter`-backed integration test:
 * that router, its Prisma-backed `OrganizationService` and the real database
 * seeding it drove are gone. What is left is the transport's own redaction
 * rule in `OrganizationTrpcApi.getAll`, exercised here over a stubbed
 * `organizations.getAllForUser` and the `batchProjectPermissions` /
 * `probeOrganizationPermission` ports that decide who gets the key.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  OrganizationTrpcApi,
  type OrganizationTrpcPorts,
} from "../../transport/api-trpc/organization.api";
import { OrganizationApp, type OrganizationAppDependencies } from "../organization.app";

type TestContext = {
  app: { organizations: OrganizationApp };
  session: { user: { id: string; name?: string | null; email?: string | null } } | null;
};

function application(organizations: Record<string, unknown>): OrganizationApp {
  return OrganizationApp.create({
    organizations: organizations as unknown as OrganizationAppDependencies["organizations"],
    projects: {} as unknown as OrganizationAppDependencies["projects"],
  });
}

function stubPorts(overrides: Partial<OrganizationTrpcPorts> = {}) {
  const ports = {
    signUpDataSchema: z.object({}),
    probeOrganizationPermission: vi.fn(async () => false),
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
    resendInvite: vi.fn(async () => ({ invite: {}, emailNotSent: false })),
    buildInviteAcceptUrl: (code: string) => `https://example.test/invite/${code}`,
    listInvites: vi.fn(async () => []),
    tryGetInviteByCode: vi.fn(async () => null),
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

const BASE_API_KEY = "test-base-key";
const STORED_LWQL_KEY = "test-lwql-key";

function organizationPayload() {
  return [
    {
      id: "org-1",
      name: "Base Key Org",
      members: [{ userId: "user-1", organizationId: "org-1", role: "MEMBER" }],
      teams: [
        {
          id: "team-1",
          members: [{ userId: "user-1", teamId: "team-1", role: "MEMBER" }],
          projects: [
            {
              id: "project-1",
              apiKey: BASE_API_KEY,
              lwqlKey: STORED_LWQL_KEY,
              s3AccessKeyId: null,
              s3SecretAccessKey: null,
              s3Endpoint: null,
            },
          ],
        },
      ],
    },
  ];
}

function harness({ canUpdateProject }: { canUpdateProject: boolean }) {
  const trpc = initTRPC.context<TestContext>().create();
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const wiredPorts = stubPorts({
    batchProjectPermissions: vi.fn(async () => new Map([["project-1", canUpdateProject]])),
  });

  const router = OrganizationTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      policy: () => (procedure) => procedure,
      auditLogPolicy: (procedure) => procedure,
    },
    wiredPorts,
  );

  const caller = router.createCaller({
    app: {
      organizations: application({ getAllForUser: vi.fn(async () => organizationPayload()) }),
    },
    session: { user: { id: "user-1" } },
  });

  return { caller };
}

describe("Feature: base key in the organizations payload", () => {
  describe("given a caller who can change the project", () => {
    /** @scenario The base key stays in the session payload for those who can change the project */
    it("includes the base key in the payload", async () => {
      const { caller } = harness({ canUpdateProject: true });

      const organizations = await caller.getAll({});
      const project = organizations[0]!.teams[0]!.projects[0]!;

      expect(project.apiKey).toBe(BASE_API_KEY);
    });
  });

  describe("given a caller who can only view the project", () => {
    /** @scenario The base key is withheld from the session payload for read-only roles */
    it("withholds the base key from the payload", async () => {
      const { caller } = harness({ canUpdateProject: false });

      const organizations = await caller.getAll({});
      const project = organizations[0]!.teams[0]!.projects[0]!;

      expect(project.apiKey).toBe("");
      expect(project.apiKey).not.toBe(BASE_API_KEY);
    });
  });

  /**
   * The LangWatchQL key is a control-plane secret, not a credential any client
   * surface renders: it is withheld from *everyone*, unlike the base key
   * which is gated on permission. The caller who CAN change the project is
   * the case that matters — a permission-gated redaction would hand it to
   * them.
   */
  describe("given the LangWatchQL key on the project", () => {
    it.each([
      ["a caller who can change the project", true],
      ["a caller who can only view the project", false],
    ])("withholds it from the payload for %s", async (_label, canUpdateProject) => {
      const { caller } = harness({ canUpdateProject });

      const organizations = await caller.getAll({});
      const project = organizations[0]!.teams[0]!.projects[0]!;

      expect(project.lwqlKey).toBe("");
      expect(project.lwqlKey).not.toBe(STORED_LWQL_KEY);
    });
  });
});
