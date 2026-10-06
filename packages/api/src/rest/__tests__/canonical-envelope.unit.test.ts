/**
 * What the canonical error envelope carries about a refusal made of several facts, and what it
 * leaves out. Specs: specs/errors/canonical-rest-error-envelope.feature,
 * specs/errors/legacy-rest-remediation-channel.feature.
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import { HandledError, ValidationError } from "@langwatch/handled-error";
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
