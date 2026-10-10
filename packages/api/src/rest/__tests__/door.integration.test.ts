import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "../../errors.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { defineRestDoor, type DoorPresented } from "../door.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

class TokenMalformedError extends HandledError {
  constructor() {
    super("connect_license_token_malformed", "the license token is malformed", { httpStatus: 401 });
  }
}

type Seen = DoorPresented<"licence_token"> | DoorPresented<"otlp_ingest">;

const Api = moduleApi<{
  record(input: { scopeId: string; holder: string; count: number }): {
    scopeId: string;
    holder: string;
    count: number;
  };
  /** What the doors ask the owning module: who holds the bearer. */
  verify(input: Seen): Promise<string>;
}>()("licensing");

const holderSession = z.object({ holder: z.string() });

const licenceRoutes = defineRestRouter(Api)
  .withNamespace("licence-door")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("licence_token")
  .post("/api/licence-door/v1/sync", "licenceDoorSync")
  .withCredential("licence_token", { session: holderSession })
  .withInput(z.object({ count: z.number() }))
  .withAccess(anyAuthenticated({ reason: "the licence token door fixture" }))
  .withOutput(z.object({ scopeId: z.string(), holder: z.string(), count: z.number() }))
  .withoutAudit("test route")
  .handle(({ app, input, scope, session }) =>
    app.record({ scopeId: scope.id, holder: session.holder, count: input.count }),
  )
  .build();

const otlpRoutes = defineRestRouter(Api)
  .withNamespace("otlp-door")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("otlp_ingest")
  .post("/api/otlp-door/v1/traces", "otlpDoorIngest")
  .withCredential("otlp_ingest", { session: holderSession })
  .withInput(z.object({ count: z.number() }))
  .withAccess(anyAuthenticated({ reason: "the OTLP ingest door fixture" }))
  .withOutput(z.object({ scopeId: z.string(), holder: z.string(), count: z.number() }))
  .withoutAudit("test route")
  .handle(({ app, input, scope, session }) =>
    app.record({ scopeId: scope.id, holder: session.holder, count: input.count }),
  )
  .build();

const licenceDoor = defineRestDoor("licence_token", {
  needs: Api,
  identify: async (presented, service) => ({
    scope: { tier: "organization", id: "organization-1" },
    session: { holder: await service.verify(presented) },
  }),
});

const otlpDoor = defineRestDoor("otlp_ingest", {
  needs: Api,
  identify: async (presented, service) => ({
    actor: { type: "api_key", id: "key-1" },
    scope: { tier: "project", id: "project-1" },
    session: { holder: await service.verify(presented) },
  }),
});

function host() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });

  return RestHost.create({
    authz: authorizationPort.forRequest(),
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
}

function owner({ seen, accept }: { seen: Seen[]; accept: (presented: Seen) => void }) {
  return {
    record: (input: { scopeId: string; holder: string; count: number }) => input,
    verify: async (presented: Seen) => {
      seen.push(presented);
      accept(presented);

      return "holder-1";
    },
  };
}

function licenceHost(seen: Seen[]) {
  const service = owner({
    seen,
    accept: ({ bearer }) => {
      if (bearer !== "lwl_live") throw new TokenMalformedError();
    },
  });
  const server = host();
  server.mount(licenceRoutes.router(), () => service, {
    middlewareBindings: [bindRestCredential("licence_token", () => licenceDoor.open(service))],
  });

  return server;
}

function otlpHost(seen: Seen[]) {
  const service = owner({
    seen,
    accept: ({ bearer }) => {
      if (bearer === null) throw new ProjectMissingCredentialsError();
      if (bearer !== "sk-lw-live") throw new ProjectInvalidCredentialsError();
    },
  });
  const server = host();
  server.mount(otlpRoutes.router(), () => service, {
    middlewareBindings: [bindRestCredential("otlp_ingest", () => otlpDoor.open(service))],
  });

  return server;
}

function post({
  server,
  path,
  headers,
  body = '{"count":3}',
}: {
  server: RestHost;
  path: string;
  headers: Record<string, string>;
  body?: string;
}) {
  return server.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const LICENCE_PATH = "/api/licence-door/v1/sync";
const OTLP_PATH = "/api/otlp-door/v1/traces";

describe("a door declared with defineRestDoor", () => {
  describe("given a caller presenting the Bearer scheme in any case", () => {
    /** @scenario "The framework hands a module-bound door the bearer" */
    it("hands the door the token alone and the request beside it", async () => {
      const seen: Seen[] = [];
      await post({
        server: licenceHost(seen),
        path: LICENCE_PATH,
        headers: { authorization: "bearer   lwl_live " },
      });

      expect(seen[0]?.bearer).toBe("lwl_live");
      expect(seen[0]?.request.url).toContain(LICENCE_PATH);
    });
  });

  describe("given a caller presenting no Bearer scheme", () => {
    /** @scenario "The framework hands a module-bound door the bearer" */
    it("hands the door no bearer", async () => {
      const seen: Seen[] = [];
      await post({
        server: otlpHost(seen),
        path: OTLP_PATH,
        headers: { authorization: "Basic cHJvamVjdDpzZWNyZXQ=" },
      });

      expect(seen[0]?.bearer).toBeNull();
    });
  });
});

describe("the licence token door", () => {
  describe("given a bearer the owning module accepts", () => {
    /** @scenario "The licence token door verifies a connect host bearer before the body" */
    it("hands the handler the holder's organization and session", async () => {
      const seen: Seen[] = [];
      const response = await post({
        server: licenceHost(seen),
        path: LICENCE_PATH,
        headers: { authorization: "Bearer lwl_live", "x-langwatch-instance": "install-1" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        scopeId: "organization-1",
        holder: "holder-1",
        count: 3,
      });
      expect(seen[0]).toMatchObject({
        bearer: "lwl_live",
        instanceId: "install-1",
        path: LICENCE_PATH,
      });
    });
  });

  describe("given a bearer the module refuses and a body that fails the schema", () => {
    /** @scenario "The licence token door verifies a connect host bearer before the body" */
    it("answers the module's own refusal, code and status intact, not the validation error", async () => {
      const response = await post({
        server: licenceHost([]),
        path: LICENCE_PATH,
        headers: { authorization: "Bearer LW-NOT-A-TOKEN" },
        body: '{"count":"many"}',
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "connect_license_token_malformed" });
    });
  });
});

describe("the OTLP ingest door", () => {
  describe("given a key the owning module accepts", () => {
    /** @scenario "The OTLP ingest door verifies the exporter's key before the body" */
    it("hands the handler the holder's project and session, and the module the raw reads", async () => {
      const seen: Seen[] = [];
      const response = await post({
        server: otlpHost(seen),
        path: OTLP_PATH,
        headers: {
          authorization: "Bearer sk-lw-live",
          "x-project-id": "project-1",
          "user-agent": "otel-exporter/1.0",
        },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ scopeId: "project-1", holder: "holder-1", count: 3 });
      expect(seen[0]).toMatchObject({
        authorization: "Bearer sk-lw-live",
        xAuthToken: null,
        xProjectId: "project-1",
        diagnostics: { path: OTLP_PATH, method: "POST", userAgent: "otel-exporter/1.0" },
      });
    });
  });

  describe("given no key", () => {
    /** @scenario "The OTLP ingest door verifies the exporter's key before the body" */
    it("answers the module's missing-credentials refusal before the body", async () => {
      const response = await post({
        server: otlpHost([]),
        path: OTLP_PATH,
        headers: {},
        body: "{not json",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
    });
  });

  describe("given a key the module refuses and a body that fails the schema", () => {
    /** @scenario "The OTLP ingest door verifies the exporter's key before the body" */
    it("answers the module's refusal, not the validation error", async () => {
      const response = await post({
        server: otlpHost([]),
        path: OTLP_PATH,
        headers: { authorization: "Bearer sk-lw-wrong" },
        body: '{"count":"many"}',
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe("given an empty X-Auth-Token", () => {
    it("hands the module the diagnostics that tell it from no header", async () => {
      const seen: Seen[] = [];
      await post({ server: otlpHost(seen), path: OTLP_PATH, headers: { "x-auth-token": "" } });

      expect(seen[0]).toMatchObject({ diagnostics: { hasEmptyAuthToken: true } });
    });
  });
});

describe("a family behind a module-bound door nobody bound", () => {
  /** @scenario "A route naming a credential nobody bound refuses the boot" */
  it("refuses the mount, naming the credential", () => {
    const server = host();

    expect(() =>
      server.mount(otlpRoutes.router(), () => owner({ seen: [], accept: () => {} })),
    ).toThrow(/"otlp_ingest", which nothing binds/);
  });
});
