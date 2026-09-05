/**
 * The support inbox, served by the API process.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { ApiAuditPort } from "../../../api-request.policy";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";
import { composeBugReportFeature } from "../bug-report.composition";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };

/** The one table the inbox reads, as a double. */
function testPrisma() {
  return {
    bugReport: {
      findMany: vi.fn(async () => [{ id: "bugreport_1", title: "CLI cannot reach the API" }]),
      count: vi.fn(async () => 1),
    },
  } as unknown as PrismaClient;
}

class RecordingAudit extends ApiAuditPort {
  readonly entries: Array<{ path: string; input: Record<string, unknown> }> = [];

  async record(event: unknown): Promise<void> {
    this.entries.push(event as { path: string; input: Record<string, unknown> });
  }
}

function composeApplication() {
  const audit = new RecordingAudit();
  const authz = {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: testPrisma(),
    authz,
    audit,
  };
  const bugReport = composeBugReportFeature({ infrastructure });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), bugReport },
    infrastructure,
    collaborators: stubCollaborators(),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
    },
  });

  return { application, audit };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const response = await application.hono.request(
    `http://127.0.0.1/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
  );
  return { status: response.status, body: await response.json() };
}

describe("given an API process composed with the support inbox", () => {
  describe("when an operator opens it", () => {
    it("reads it through the repository in the ops package, and audits the read", async () => {
      const { application, audit } = composeApplication();

      const { status, body } = await callTrpc(application, "bugReports.getAll", {
        page: 0,
        pageSize: 25,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { total: 1, reports: [{ id: "bugreport_1" }] } } },
      });
      // Awaited, not fire-and-forget: the row is the record of who opened
      // somebody's transcript and it is written before they see it. The
      // `targetKind` is what makes it this port's row rather than the policy
      // chain's own entry for the same call.
      const entry = audit.entries.find((written) => written.path === "bugReports.getAll");
      expect(entry?.input).toMatchObject({ targetKind: "bugReport" });
    });
  });
});
