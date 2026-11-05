/**
 * @vitest-environment node
 * The REST runtime counts each authenticated request into the credential census and names the
 * project and credential on its access line, without changing what the door answers.
 * @see modules/auth/specs/request-credential-census.feature
 */
import {
  PermissionDeniedError,
  type RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import type * as Census from "@langwatch/observability/credential-census";
import { noteRequestCredential } from "@langwatch/observability/credential-census";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { ProjectInvalidCredentialsError } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { recordProjectCredential } from "../credential.ts";
import { defineRestRouter, type RestDoorCredential } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const captured = vi.hoisted(() => ({
  census: [] as Census.CensusRequest[],
  access: [] as Record<string, unknown>[],
}));

vi.mock("@langwatch/observability/credential-census", async (importOriginal) => {
  const actual = await importOriginal<typeof Census>();
  return {
    ...actual,
    recordCredentialCensus: (request: Census.CensusRequest) => captured.census.push(request),
  };
});

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name !== actual.REQUEST_LOGGER_NAME) return logger;
      const record = (fields: Record<string, unknown>) => captured.access.push(fields);
      return Object.assign(Object.create(logger), { info: record, warn: record, error: record });
    },
  };
});

const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

const PYTHON_SDK = {
  "user-agent": "langwatch-sdk-python/0.9.0",
  "x-langwatch-sdk-name": "langwatch-observability-sdk",
  "x-langwatch-sdk-language": "python",
  "x-langwatch-sdk-version": "0.9.0",
};

const CLI = {
  "user-agent": "langwatch-sdk-node/3.1.0",
  "x-langwatch-sdk-name": "langwatch-observability-sdk",
  "x-langwatch-sdk-language": "typescript",
  "x-langwatch-sdk-version": "3.1.0",
  "x-langwatch-surface": "cli",
};

const Api = moduleApi<{ read(input: { thingId: string }): { ok: boolean } }>()("prompt");

function family(credential: RestDoorCredential) {
  const router = defineRestRouter(Api)
    .withNamespace("things")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })
    .withCredential(credential)
    .get("/api/things/:thingId", "readThing")
    .withParams(z.object({ thingId: z.string() }));
  if (credential === "project") {
    return router
      .withPermission("prompts:view")
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app, input }) => app.read(input))
      .build();
  }

  return router
    .withAccess(anyAuthenticated({ reason: "the door is the whole gate in this test" }))
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app, input }) => app.read(input))
    .build();
}

/** What the project door resolves each test token to; the key directory notes as it resolves. */
const RESOLVED: Record<string, RestResolvedProjectCredential> = {
  "legacy-token": { type: "legacyProjectKey", project: PROJECT },
  "sk-lw-new_secret": {
    type: "apiKey",
    apiKeyId: "key-1",
    userId: "user-1",
    organizationId: PROJECT.organizationId,
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  },
  lw_at_access: {
    type: "cliAccessToken",
    userId: "user-1",
    organizationId: PROJECT.organizationId,
    project: PROJECT,
  },
};

/** The project door as auth binds it: resolve, record what it resolved, then ask the permission. */
const projectDoor: RestIdentity = {
  authenticate: ({ request, permission }) => {
    const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    if (token === "sk-lw-cli-login_secret") {
      noteRequestCredential({ credentialType: "cli_token", apiKeyId: "key-cli", projectId: "p" });
    }
    if (token === "sk-lw-viewer_secret") {
      noteRequestCredential({ credentialType: "api_key", apiKeyId: "key-2", projectId: "p" });
      throw new PermissionDeniedError({
        permission,
        scope: { type: "project", id: PROJECT.id },
        denialReason: "no-grant",
      });
    }
    const resolved = RESOLVED[token === "sk-lw-cli-login_secret" ? "sk-lw-new_secret" : token];
    if (!resolved) throw new ProjectInvalidCredentialsError();
    recordProjectCredential(request, resolved);

    return { actor: null, scope: { tier: "project", id: PROJECT.id } };
  },
};

const scopedDoor = (scope: { tier: "project" | "organization"; id: string }): RestIdentity => ({
  authenticate: () => ({ actor: { type: "user", id: "user-1" }, scope }),
  identify: () => ({ actor: { type: "user", id: "user-1" }, scope }),
});

function mounted(credential: RestDoorCredential, door: RestIdentity) {
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: door,
    doors: { [credential]: door },
  });

  return runtime.mount(family(credential).router(), {
    app: () => ({ read: () => ({ ok: true }) }),
    onError: (error, context: Context) =>
      context.json(
        { code: (error as { code?: string }).code ?? "internal_error" },
        ((error as { httpStatus?: number }).httpStatus ?? 500) as 401,
      ),
  });
}

const call = (
  credential: RestDoorCredential,
  door: RestIdentity,
  { token, headers = {} }: { token?: string; headers?: Record<string, string> } = {},
) =>
  mounted(credential, door).request("/api/things/thing-42?secret=query-value", {
    headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });

describe("the credential census on the REST runtime", () => {
  beforeEach(() => {
    captured.census.length = 0;
    captured.access.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a legacy project key sent by the Python SDK", () => {
    /** @scenario "A legacy project key sent by the Python SDK is counted as a legacy key from sdk-python" */
    it("counts it as a legacy key for its project, from sdk-python, at the route template", async () => {
      const response = await call("project", projectDoor, {
        token: "legacy-token",
        headers: PYTHON_SDK,
      });

      expect(response.status).toBe(200);
      expect(captured.census).toEqual([
        expect.objectContaining({
          credentialType: "legacy_project_key",
          projectId: PROJECT.id,
          organizationId: PROJECT.organizationId,
          method: "GET",
          route: "/api/things/:thingId",
          family: "things",
          client: "sdk-python",
          sdkName: "langwatch-observability-sdk",
          sdkVersion: "0.9.0",
          status: 200,
        }),
      ]);
    });

    /** @scenario "The census line never carries the token or the query string" */
    it("carries neither the token nor the query string", async () => {
      await call("project", projectDoor, { token: "legacy-token", headers: PYTHON_SDK });

      const counted = JSON.stringify(captured.census);
      expect(counted).not.toContain("legacy-token");
      expect(counted).not.toContain("query-value");
      expect(counted).not.toContain("thing-42");
    });
  });

  describe("given a new API key sent by the CLI", () => {
    /** @scenario "A new API key sent by the CLI is counted with its key id and client cli" */
    it("counts it as an API key with its row id, from the CLI", async () => {
      const response = await call("project", projectDoor, {
        token: "sk-lw-new_secret",
        headers: CLI,
      });

      expect(response.status).toBe(200);
      expect(captured.census).toEqual([
        expect.objectContaining({ credentialType: "api_key", apiKeyId: "key-1", client: "cli" }),
      ]);
    });

    it("keeps what the key directory noted, so a CLI login's key stays a CLI token", async () => {
      await call("project", projectDoor, { token: "sk-lw-cli-login_secret", headers: CLI });

      expect(captured.census).toEqual([
        expect.objectContaining({ credentialType: "cli_token", apiKeyId: "key-cli" }),
      ]);
    });
  });

  describe("given a project-bound CLI access token", () => {
    /** @scenario "A CLI access token is counted as a CLI token" */
    it("counts it as a CLI token for its project", async () => {
      await call("project", projectDoor, { token: "lw_at_access", headers: CLI });

      expect(captured.census).toEqual([
        expect.objectContaining({ credentialType: "cli_token", projectId: PROJECT.id }),
      ]);
      expect(captured.census[0]?.apiKeyId).toBeUndefined();
    });
  });

  describe("given a browser session on a REST route", () => {
    /** @scenario "A browser session on a REST route is counted as a session" */
    it("counts it as a session from the browser", async () => {
      await call("browser", scopedDoor({ tier: "project", id: PROJECT.id }), {
        headers: { "user-agent": "Mozilla/5.0" },
      });

      expect(captured.census).toEqual([
        expect.objectContaining({
          credentialType: "session",
          projectId: PROJECT.id,
          client: "browser",
        }),
      ]);
    });
  });

  describe("given a route behind the internal secret door", () => {
    /** @scenario "An internal credential is counted as the system" */
    it("counts it as the system", async () => {
      await call("internal_secret", scopedDoor({ tier: "organization", id: "organization-1" }));

      expect(captured.census).toEqual([
        expect.objectContaining({ credentialType: "system", organizationId: "organization-1" }),
      ]);
    });
  });

  describe("given a token that matches no key", () => {
    /** @scenario "A token that resolves no credential is not counted" */
    it("counts nothing and answers the refusal as before", async () => {
      const response = await call("project", projectDoor, { token: "nobody", headers: PYTHON_SDK });

      expect(response.status).toBe(401);
      expect(captured.census).toEqual([]);
    });
  });

  describe("given a key that may not call the route and one that may", () => {
    /** @scenario "Counting a request does not change its authorization answer" */
    it("refuses the one and answers the other, counting each with its status", async () => {
      const refused = await call("project", projectDoor, { token: "sk-lw-viewer_secret" });
      const answered = await call("project", projectDoor, { token: "sk-lw-new_secret" });

      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ code: "permission_denied" });
      expect(answered.status).toBe(200);
      expect(captured.census.map(({ apiKeyId, status }) => ({ apiKeyId, status }))).toEqual([
        { apiKeyId: "key-2", status: 403 },
        { apiKeyId: "key-1", status: 200 },
      ]);
    });
  });

  describe("when an authenticated request is answered", () => {
    /** @scenario "The access line names the project and the credential type" */
    it("names its project and credential type on the access line", async () => {
      await call("project", projectDoor, { token: "legacy-token", headers: PYTHON_SDK });

      expect(captured.access).toEqual([
        expect.objectContaining({
          projectId: PROJECT.id,
          credentialType: "legacy_project_key",
          route: "GET /api/things/:thingId",
        }),
      ]);
    });

    /** @scenario "The request span carries the credential and client attributes" */
    it("tags its span with the credential and the client", async () => {
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      const span = provider.getTracer("test").startSpan("request");
      vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

      await call("project", projectDoor, { token: "legacy-token", headers: PYTHON_SDK });
      span.end();

      expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({
        "langwatch.auth.credential_type": "legacy_project_key",
        "langwatch.auth.project_id": PROJECT.id,
        "langwatch.client.name": "sdk-python",
        "langwatch.client.sdk_version": "0.9.0",
      });
    });
  });
});
