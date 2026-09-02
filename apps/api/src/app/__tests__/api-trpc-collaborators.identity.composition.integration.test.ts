/**
 * The identity half of the packaged tRPC record, served by the API process.
 *
 * What this pins is the seam the migration turns on for every person-shaped
 * surface: `composeApiIdentityCollaborators` overlaid onto the record's
 * collaborator set, built on THIS process's root, with THIS process's policy
 * chain, reachable over the real `/api/trpc` handler.
 *
 * Two calls, one per side of the half, and neither is a stub reached through a
 * proxy:
 *
 *   onboarding.initializeOrganization  the ORGANIZATION side. It runs the whole
 *                                      moved membership service — the ksuid and
 *                                      slug minting, the one transaction, and
 *                                      the founder's two ADMIN grants on the
 *                                      grant ledger — through
 *                                      `ctx.app.organizations`.
 *   user.getAccountInfo                the AUTH/USER side, off `ctx.app.users`:
 *                                      the application this composition builds
 *                                      over the SAME user directory the
 *                                      browser-session boundary resolves
 *                                      through.
 *
 * And one refusal, because a named absence that nobody can observe is
 * indistinguishable from a stub: the SCIM plan gate this process does not hold
 * refuses `group.listAll` by name rather than listing groups it cannot
 * authorize.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthService } from "@langwatch/auth-contract";
import type {
  AuthzGetDecisionInput,
  AuthzGrantsService,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import { IdentityEventingPort } from "@langwatch/identity-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import { ApiAuditPort } from "../../api-request.policy";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  composeApiIdentityCollaborators,
  withApiIdentityCollaborators,
} from "../api-trpc-collaborators.identity.composition";

/**
 * A collaborator group with only the members the record reads while it is being
 * BUILT — the input schemas, and the one decorator a rollout gate applies to a
 * procedure. Everything else answers a function that refuses by name when a
 * call actually reaches it.
 */
function stub<T>(group: string, buildTime: Record<string, unknown> = {}): T {
  return new Proxy(buildTime, {
    get(target, property) {
      if (property in target) return target[property as string];
      return () => {
        throw new Error(`the test reached ${group}.${String(property)}, which it does not stub`);
      };
    },
    has: () => true,
  }) as T;
}

const anySchema = z.any();
const openGate = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

const SESSION_USER = {
  id: "user-1",
  name: "Sam Rivers",
  email: "sam@acme.test",
  role: "ADMIN",
};

const accountInfo = {
  id: SESSION_USER.id,
  name: SESSION_USER.name,
  email: SESSION_USER.email,
  image: null,
};

/**
 * The rows the organization side actually writes, recorded.
 *
 * A double rather than a database, and the assertions are on the WRITES rather
 * than on a returned object, because what the move has to preserve is the shape
 * of those writes: an organization row carrying its ksuid and derived slug, a
 * founding ADMIN membership, and a first team — in one transaction, before the
 * grants that point at them.
 */
function testPrisma() {
  const writes: Array<{ model: string; data: Record<string, unknown> }> = [];
  const record = (model: string) => ({
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      writes.push({ model, data });
      return data;
    }),
  });

  const transactionClient = {
    organization: record("organization"),
    organizationUser: record("organizationUser"),
    team: record("team"),
  };

  const client = {
    $transaction: vi.fn(
      async (run: (tx: typeof transactionClient) => Promise<unknown>) =>
        await run(transactionClient),
    ),
    user: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    organizationInvite: { findUnique: vi.fn(async () => null) },
    organizationUser: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;

  return { client, writes, transaction: (client as unknown as { $transaction: unknown }).$transaction };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async (_input: AuthzGetDecisionInput): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    getProjectAnyDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    checkScopeLineage: async (): Promise<AuthzScopeLineageResult> => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/** The grant ledger, recording the founder's two ADMIN bindings. */
function testGrants() {
  const attachBindings = vi.fn(async (_input: { bindings: unknown[] }) => undefined);
  return {
    grants: { attachBindings, invalidateOrganization: async () => undefined } as unknown as
      AuthzGrantsService,
    attachBindings,
  };
}

/** No event stack: the identity ledger stages nothing, which nothing here needs. */
class SilentEventing extends IdentityEventingPort {
  async tryPipelineCommand() {
    return null;
  }

  async tryEventStore() {
    return null;
  }
}

function composeIdentityHalf(prisma: PrismaClient, grants: AuthzGrantsService) {
  return composeApiIdentityCollaborators({
    prisma,
    organizations: {
      getSettings: async () => ({ supportContact: null }),
    } as unknown as OrganizationService,
    projects: {
      create: async () => ({ slug: "acme-1" }),
    } as unknown as ProjectService,
    apiKeys: {} as unknown as ApiKeyService,
    grants,
    users: {
      getAccountInfo: async () => accountInfo,
    } as unknown as UserService,
    auth: {} as unknown as AuthService,
    redis: null,
    rateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
    eventing: new SilentEventing(),
    deployment: {
      baseUrl: "https://app.acme.test",
      adminEmails: "staff@langwatch.ai",
    },
    resources: { own: () => undefined },
    processName: "langwatch-api",
  });
}

/**
 * The rest of the record, stubbed: this file describes the identity half, and a
 * namespace it does not own answering a call would mean the test had wandered.
 */
function baseCollaborators(): AnyApiTrpcCollaborators {
  return {
    application: stub<ApiTrpcFeatureApplication>("app"),
    analytics: {
      reads: stub("analytics.reads", {
        timeseriesInputSchema: anySchema,
        sharedFiltersSchema: anySchema,
        filterFieldSchema: anySchema,
      }),
      workbench: stub("analytics.workbench", {
        requireWorkbenchEnabled: openGate,
        maxStatementLength: 4_000,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
      savedCharts: stub("analytics.savedCharts", {
        requireWorkbenchEnabled: openGate,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
    },
    annotation: stub("annotation"),
    auth: stub("auth"),
    bugReports: stub("bugReports"),
    dataPrivacy: stub("dataPrivacy"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    graphs: stub("graphs", { filterFieldSchema: anySchema }),
    group: stub("group"),
    identity: stub("identity"),
    integrationsChecks: stub("integrationsChecks"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

class RecordingAudit extends ApiAuditPort {
  readonly entries: unknown[] = [];

  async record(event: unknown): Promise<void> {
    this.entries.push(event);
  }
}

function composeApplication() {
  const prisma = testPrisma();
  const { grants, attachBindings } = testGrants();
  const audit = new RecordingAudit();

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit,
    collaborators: withApiIdentityCollaborators(
      baseCollaborators(),
      composeIdentityHalf(prisma.client, grants),
    ),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
      audit: async (event) => {
        await audit.record(event);
      },
    },
  });

  return { application, prisma, attachBindings };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
  method: "query" | "mutation" = "query",
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const url = `http://127.0.0.1/api/trpc/${path}`;
  const response =
    method === "mutation"
      ? await application.hono.request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        })
      : await application.hono.request(
          `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
        );
  return { status: response.status, body: await response.json() };
}

describe("given an API process composed with the identity half of the record", () => {
  describe("when the sign-up ceremony creates somebody's first organization", () => {
    /** @scenario "A new organization is created with its first team" */
    it("runs the moved membership service through the real /api/trpc handler", async () => {
      const { application, prisma, attachBindings } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "onboarding.initializeOrganization",
        { orgName: "Acme", projectName: "Acme", language: "python", framework: "other" },
        "mutation",
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { success: true, teamName: "Acme", projectSlug: "acme-1" } } },
      });

      // The organization, its founding membership and its first team, in one
      // transaction and in that order — the shape the move had to preserve.
      expect(prisma.writes.map((write) => write.model)).toEqual([
        "organization",
        "organizationUser",
        "team",
      ]);
      const organization = prisma.writes[0]?.data;
      expect(organization?.name).toBe("Acme");
      // The ksuid prefix and the slug rule are PERSISTED formats: a changed
      // prefix produces ids the existing rows do not match.
      expect(String(organization?.id)).toMatch(/^organization_/);
      expect(String(organization?.slug)).toMatch(/^acme-/);
      expect(prisma.writes[1]?.data).toMatchObject({ userId: "user-1", role: "ADMIN" });

      // The founder's two ADMIN grants follow the rows they point at, because
      // a grant is a ledger fact and cannot ride a database transaction.
      expect(attachBindings).toHaveBeenCalledTimes(1);
      const bindings = attachBindings.mock.calls[0]?.[0].bindings ?? [];
      expect(bindings).toHaveLength(2);
      expect(bindings).toEqual([
        expect.objectContaining({ scopeType: "ORGANIZATION", role: "ADMIN" }),
        expect.objectContaining({ scopeType: "TEAM", role: "ADMIN" }),
      ]);
    });
  });

  describe("when the signed-in person reads their own account", () => {
    it("answers off the user application this composition built", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "user.getAccountInfo", {});

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { id: "user-1", email: "sam@acme.test" } } },
      });
    });
  });

  describe("when a surface needs an Enterprise capability this process does not hold", () => {
    /** @scenario "A capability the deployment does not hold refuses by name" */
    it("refuses by name rather than answering without the plan gate", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "group.listAll", {
        organizationId: "org-1",
      });

      // Asserted on the CODE rather than on prose or on the HTTP number: the
      // code is what the client presentation registry is keyed by, and it is
      // the half that survives the tRPC boundary (#5984 puts the code on the
      // wire in place of the message).
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("service_unavailable");
      expect(serialized).toContain("Enterprise plan store");
    });
  });
});
