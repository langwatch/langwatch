/**
 * @vitest-environment node
 * Spec: specs/observability/request-log-client-and-principal.feature
 */
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import type * as Observability from "@langwatch/observability";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { beforeEach, describe, expect, it, vi } from "vitest";

const records = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name !== actual.REQUEST_LOGGER_NAME) return logger;
      const capture = (fields: Record<string, unknown>) => records.push(fields);
      return Object.assign(Object.create(logger), { info: capture, warn: capture, error: capture });
    },
  };
});

const { collectorRest } = await import("../collector.rest.ts");

const SECRET = "sk-lw-never-logged-collector-secret";
const project = { id: "project-1", teamId: "team-1", organizationId: "org-1" };

function collectorHost() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    authz: restTestAuthorization().forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  host.mount(collectorRest.router(), () => ({
    collectorCredential: async () => ({
      project,
      markUsed: () => undefined,
      key: { kind: "api_key" as const, apiKeyId: "key_collector", ownerUserId: null },
    }),
    collectorUsageLimit: async () => undefined,
    collectorIngest: async () => {
      throw new Error("an empty body is refused before it is ingested");
    },
    collectorReportError: () => undefined,
  }));
  return host;
}

describe("POST /api/collector's access record", () => {
  beforeEach(() => {
    records.length = 0;
  });

  describe("when an API key authenticates the request", () => {
    /** @scenario "The request log names the API key and its kind, never the key" */
    it("names the key id and kind the handler resolved, and nothing of the secret", async () => {
      const response = await collectorHost().app.request("http://localhost/api/collector", {
        method: "POST",
        headers: { "X-Auth-Token": SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBeLessThan(500);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        "api_key.id": "key_collector",
        "api_key.type": "api_key",
      });
      expect(JSON.stringify(records[0])).not.toContain(SECRET);
    });
  });
});
