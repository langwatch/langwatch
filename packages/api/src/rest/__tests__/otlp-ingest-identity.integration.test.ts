import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "../../errors.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { OtlpIngestIdentity, type OtlpIngestPresented } from "../otlp-ingest-identity.ts";
import { bindRestCredential } from "../request.ts";

const sessionSchema = z.object({ apiKeyId: z.string() });

const Api = moduleApi<{
  ingest(input: { projectId: string; apiKeyId: string; bytes: number }): {
    projectId: string;
    apiKeyId: string;
    bytes: number;
  };
}>()("trace");

const declaration = defineRestRouter(Api)
  .withNamespace("otlp-door")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("otlp_ingest")
  .post("/api/otlp-door/v1/traces", "otlpDoorIngest")
  .withCredential("otlp_ingest", { session: sessionSchema })
  .withInput(z.object({ spans: z.number() }))
  .withAccess(anyAuthenticated({ reason: "the OTLP ingest door fixture" }))
  .withOutput(z.object({ projectId: z.string(), apiKeyId: z.string(), bytes: z.number() }))
  .handle(({ app, input, scope, session }) =>
    app.ingest({ projectId: scope.id, apiKeyId: session.apiKeyId, bytes: input.spans }),
  )
  .build();

function hostWith({
  presented,
  bound = true,
}: {
  presented: OtlpIngestPresented[];
  bound?: boolean;
}) {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  const door = OtlpIngestIdentity.create({
    verify: async (key) => {
      presented.push(key);
      if (!key.authorization && !key.xAuthToken) throw new ProjectMissingCredentialsError();
      if (key.authorization !== "Bearer sk-lw-live") throw new ProjectInvalidCredentialsError();

      return {
        actor: { type: "api_key", id: "key-1" },
        projectId: "project-1",
        session: { apiKeyId: "key-1" },
      };
    },
  });
  host.mount(declaration.router(), () => ({ ingest: (input: object) => input }), {
    facts: bound ? [bindRestCredential("otlp_ingest", () => door)] : [],
  });

  return host;
}

function post(host: RestHost, headers: Record<string, string>, body = '{"spans":3}') {
  return host.app.request("/api/otlp-door/v1/traces", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("the OTLP ingest door", () => {
  describe("given a key the owning module accepts", () => {
    /** @scenario "The OTLP ingest door verifies the exporter's key before the body" */
    it("hands the handler the holder's project and session", async () => {
      const presented: OtlpIngestPresented[] = [];
      const response = await post(hostWith({ presented }), {
        authorization: "Bearer sk-lw-live",
        "x-project-id": "project-1",
        "user-agent": "otel-exporter/1.0",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        projectId: "project-1",
        apiKeyId: "key-1",
        bytes: 3,
      });
      expect(presented[0]).toMatchObject({
        authorization: "Bearer sk-lw-live",
        xAuthToken: null,
        xProjectId: "project-1",
        diagnostics: {
          path: "/api/otlp-door/v1/traces",
          method: "POST",
          userAgent: "otel-exporter/1.0",
        },
      });
    });
  });

  describe("given no key", () => {
    /** @scenario "The OTLP ingest door verifies the exporter's key before the body" */
    it("answers the module's missing-credentials refusal before the body", async () => {
      const response = await post(hostWith({ presented: [] }), {}, "{not json");

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
    });
  });

  describe("given a key the module refuses and a body that fails the schema", () => {
    it("answers the module's refusal, not the validation error", async () => {
      const response = await post(
        hostWith({ presented: [] }),
        { authorization: "Bearer sk-lw-wrong" },
        '{"spans":"many"}',
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe("given an empty X-Auth-Token", () => {
    it("hands the module the diagnostics that tell it from no header", async () => {
      const presented: OtlpIngestPresented[] = [];
      await post(hostWith({ presented }), { "x-auth-token": "" });

      expect(presented[0]?.diagnostics.hasEmptyAuthToken).toBe(true);
    });
  });

  describe("given a family no module bound the door for", () => {
    /** @scenario "The OTLP ingest door verifies the exporter's key before the body" */
    it("lets nobody in", async () => {
      const presented: OtlpIngestPresented[] = [];
      const response = await post(hostWith({ presented, bound: false }), {
        authorization: "Bearer sk-lw-live",
      });

      expect(response.status).toBe(404);
      expect(presented).toEqual([]);
    });
  });
});
