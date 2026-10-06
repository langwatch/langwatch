/**
 * What the canonical error envelope carries about a refusal made of several facts, and what it
 * leaves out. Specs: specs/errors/canonical-rest-error-envelope.feature,
 * specs/errors/legacy-rest-remediation-channel.feature.
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import { HandledError, remediation, ValidationError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { RestIdentity } from "../../hosting/api-door.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { defineRestRouter } from "../declaration.ts";
import { createCanonicalFamilyErrorHandler, canonicalErrorFor } from "../response.ts";
import { createRestRuntime } from "../runtime.ts";

const TRACE = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" };

class RejectedFieldError extends HandledError {
  constructor({ field, traceIds }: { field: string; traceIds?: typeof TRACE }) {
    super("field_rejected", `${field} was rejected`, {
      httpStatus: 422,
      fault: "customer",
      meta: { field },
      ...traceIds,
    });
    this.name = "RejectedFieldError";
  }
}

class RefusedBySeveralFactsError extends HandledError {
  constructor({ fields, traceIds }: { fields: string[]; traceIds?: typeof TRACE }) {
    super("fields_rejected", "Several fields were rejected", {
      httpStatus: 422,
      fault: "customer",
      reasons: fields.map((field) => new RejectedFieldError({ field, traceIds })),
      ...traceIds,
    });
    this.name = "RefusedBySeveralFactsError";
  }
}

function reasonsOf(body: { meta?: Record<string, unknown> }): { meta?: { field?: string } }[] {
  return (body.meta?.reasons ?? []) as { meta?: { field?: string } }[];
}

describe("a canonical-envelope family answering a refusal made of several facts", () => {
  /** @scenario "A refusal made of several facts ships its reasons chain" */
  /** @scenario "A refusal made of several facts ships all of them" */
  it("carries one reason for each rejected field", () => {
    const failure = new RefusedBySeveralFactsError({ fields: ["name", "metric", "window"] });

    const { status, body } = canonicalErrorFor(failure);

    expect(status).toBe(422);
    expect(body.code).toBe("fields_rejected");
    expect(reasonsOf(body).map((reason) => reason.meta?.field)).toEqual([
      "name",
      "metric",
      "window",
    ]);
  });

  /** @scenario "A refusal made of several facts ships its reasons chain" */
  it("carries one reason for each field a rejected schema names", () => {
    const parsed = z.object({ name: z.string().min(1), metric: z.enum(["cost"]) }).safeParse({
      name: "",
      metric: "nope",
    });
    if (parsed.success) throw new Error("expected the parse to fail");

    const { body } = canonicalErrorFor(ValidationError.fromZodError(parsed.error));

    expect(body.code).toBe("validation_error");
    expect(
      Object.keys((body.meta?.fieldErrors ?? {}) as Record<string, unknown>).toSorted(),
    ).toEqual(["metric", "name"]);
  });
});

class PlanRefusedError extends HandledError {
  constructor() {
    super("enterprise_plan_required", "This needs the Enterprise plan", {
      httpStatus: 402,
      fault: "customer",
      meta: { feature: "MANAGEMENT_API" },
      ...remediation("enterprise_plan_required"),
    });
    this.name = "PlanRefusedError";
  }
}

class KeyCeilingError extends HandledError {
  constructor() {
    super("api_key_permission_denied", "The API key does not grant this permission", {
      httpStatus: 403,
      fault: "customer",
      ...remediation("api_key_permission_denied"),
    });
    this.name = "KeyCeilingError";
  }
}

class RefusalWith extends HandledError {
  constructor({
    code,
    message,
    ...options
  }: { code: string; message: string } & ConstructorParameters<typeof HandledError>[2]) {
    super(code, message, options);
    this.name = "RefusalWith";
  }
}

describe("a canonical-envelope family answering a refusal that knows its next step", () => {
  /** @scenario "A handled refusal ships its remediation channel in the envelope" */
  /** @scenario "A handled refusal ships its tips and documentation link" */
  it("carries the refusal's tips, documentation link and fault", () => {
    const { status, body } = canonicalErrorFor(new PlanRefusedError());

    expect(status).toBe(402);
    expect(body.code).toBe("enterprise_plan_required");
    expect(body.meta).toMatchObject({ feature: "MANAGEMENT_API" });
    expect(body.tips).toEqual(remediation("enterprise_plan_required").tips);
    expect(body.docs_url).toBe(remediation("enterprise_plan_required").docsUrl);
    expect(body.docs_url).toMatch(/^https?:\/\//);
    expect(body.fault).toBe("customer");
  });

  /** @scenario "A handled refusal says who can act on it" */
  it("says the fault is the platform's when the refusal is attributed to it", () => {
    const failure = new RefusalWith({
      code: "quota_ledger_stale",
      message: "The ledger is catching up",
      httpStatus: 409,
      fault: "platform",
    });

    const { body } = canonicalErrorFor(failure);

    expect(body.fault).toBe("platform");
  });

  /** @scenario "A handled refusal ships its tips and documentation link" */
  it("leaves tips and the documentation link out of a refusal that has none", () => {
    const { body } = canonicalErrorFor(new RejectedFieldError({ field: "name" }));

    expect(body).not.toHaveProperty("tips");
    expect(body).not.toHaveProperty("docs_url");
  });

  /** @scenario "An unanticipated cause behind a handled refusal stays masked" */
  it("reports a non-handled cause as unknown and names none of its detail", () => {
    const failure = new RefusalWith({
      code: "store_unavailable",
      message: "The store did not answer",
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error("connect ECONNRESET 10.0.3.7:5432 prisma.user.findMany")],
    });

    const { body } = canonicalErrorFor(failure);

    expect(reasonsOf(body)).toMatchObject([{ code: "unknown" }]);
    expect(JSON.stringify(body)).not.toMatch(/ECONNRESET|10\.0\.3\.7|prisma/);
  });

  it("keeps a 5xx the platform owns opaque, with no tips or fault", () => {
    const failure = new RefusalWith({
      code: "lwql_unavailable",
      message: "Warehouse host ch-7 is down",
      httpStatus: 503,
      fault: "platform",
      tips: ["Restart ch-7"],
      docsUrl: "https://docs.example.test/internal",
    });

    const { status, body } = canonicalErrorFor(failure);

    expect(status).toBe(503);
    expect(body.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toMatch(/ch-7|internal"|Restart/);
    expect(body).not.toHaveProperty("tips");
    expect(body).not.toHaveProperty("fault");
  });
});

describe("a traced request answering a refusal that carries a reason of its own", () => {
  /** @scenario "A response carries one trace-id pair" */
  it("states the trace and span ids once, on the envelope", () => {
    const failure = new RefusedBySeveralFactsError({ fields: ["name", "metric"], traceIds: TRACE });

    const { body } = canonicalErrorFor(failure, TRACE);

    expect(body.trace_id).toBe(TRACE.traceId);
    expect(body.span_id).toBe(TRACE.spanId);
    const wire = JSON.stringify(body);
    expect(wire.split(TRACE.traceId)).toHaveLength(2);
    expect(wire.split(TRACE.spanId)).toHaveLength(2);
  });

  /** @scenario "A response carries one trace-id pair" */
  it("leaves every entry of the reasons chain without its own ids", () => {
    const failure = new RefusedBySeveralFactsError({ fields: ["name", "metric"], traceIds: TRACE });

    const { body } = canonicalErrorFor(failure, TRACE);

    expect((failure.reasons[0] as RejectedFieldError).traceId).toBe(TRACE.traceId);
    const reasons = reasonsOf(body);
    expect(reasons).toHaveLength(2);
    for (const reason of reasons) {
      expect(Object.keys(reason)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/trace|span/i)]),
      );
      expect(JSON.stringify(reason)).not.toMatch(/trace|span/i);
    }
  });
});

const Api = moduleApi<{ read(): { ok: boolean } }>()("gateway");

const keys = defineRestRouter(Api)
  .withNamespace("gateway")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("api_key")
  .get("/api/keys", "listKeys")
  .withPermission("virtualKeys:view")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

describe("a route whose API key does not grant the permission it requires", () => {
  const door: RestIdentity = {
    authenticate: ({ permission }) => {
      throw new PermissionDeniedError({
        permission,
        scope: { type: "project", id: "project-secret" },
        denialReason: "no-binding",
      });
    },
  };
  const ceilingDoor: RestIdentity = {
    authenticate: () => {
      throw new KeyCeilingError();
    },
  };

  /** @scenario "A denial answered by the security middleware carries the same channel" */
  it("answers a denial carrying the tips, documentation link and fault for re-scoping the key", async () => {
    const runtime = createRestRuntime({ identity: ceilingDoor, doors: { api_key: ceilingDoor } });
    const hono = runtime.mount(keys.router(), {
      app: () => ({ read: () => ({ ok: true }) }),
      onError: createCanonicalFamilyErrorHandler({
        loggerName: "langwatch:api:test:errors",
        label: "Test API Error",
      }),
    });

    const response = await hono.request("/api/keys");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "api_key_permission_denied",
      tips: remediation("api_key_permission_denied").tips,
      docs_url: remediation("api_key_permission_denied").docsUrl,
      fault: "customer",
    });
  });

  /** @scenario "An API-key ceiling denial carries no identifier fields" */
  it("answers a denial whose body names no apiKeyId, userId or projectId", async () => {
    const runtime = createRestRuntime({ identity: door, doors: { api_key: door } });
    const hono = runtime.mount(keys.router(), {
      app: () => ({ read: () => ({ ok: true }) }),
      onError: createCanonicalFamilyErrorHandler({
        loggerName: "langwatch:api:test:errors",
        label: "Test API Error",
      }),
    });

    const response = await hono.request("/api/keys");
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(JSON.parse(text)).toMatchObject({ code: "permission_denied" });
    for (const field of ["apiKeyId", "userId", "projectId", "project-secret"]) {
      expect(text).not.toContain(field);
    }
  });
});
