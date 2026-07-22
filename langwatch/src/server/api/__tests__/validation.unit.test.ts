import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { handleError } from "~/app/api/middleware/error-handler";
import { validator as zValidator } from "../validation";

/**
 * These run against a REAL Hono app with the REAL error handler mounted, because
 * the whole point of the wrapper is what happens BETWEEN those two: the stock
 * validator answers a schema failure itself and `onError` never runs, so a test
 * that called the middleware in isolation would pass while the boundary stayed
 * broken. Only an end-to-end request proves the failure reaches `handleError`.
 */
const schema = z.object({
  name: z.string().min(1),
  metric: z.enum(["latency", "cost"]),
  limit: z.number().max(100).optional(),
});

function appWith(hook?: Parameters<typeof zValidator>[2]) {
  const app = new Hono();
  app.onError(handleError);
  app.post("/", zValidator("json", schema, hook), (c) =>
    c.json({ ok: true, received: c.req.valid("json") }),
  );
  return app;
}

const post = (body: unknown, app = appWith()) =>
  app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("the REST boundary's request validator", () => {
  describe("given a body that parses but fails the schema", () => {
    it("answers 422 with the handled-error code, not the validator's own 400", async () => {
      const res = await post({ name: "", metric: "latency" });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("keeps the message to one sentence naming the target", async () => {
      const res = await post({ name: "", metric: "latency" });

      const body = await res.json();
      expect(body.message).toBe(
        "The request body didn't match the expected shape.",
      );
      expect(body.target).toBe("json");
    });

    it("reports every violation, not just the first", async () => {
      const res = await post({ name: "", metric: "nope", limit: 500 });

      const body = await res.json();
      expect(body.reasons).toHaveLength(3);
      expect(body.reasons.map((r: { meta: { field: string } }) => r.meta.field))
        .toEqual(["name", "metric", "limit"]);
      expect(body.fields).toEqual(["name", "metric", "limit"]);
    });

    it("names each reason schema_failure and locates it", async () => {
      const res = await post({ name: "ok", metric: "nope" });

      const body = await res.json();
      const [reason] = body.reasons;
      expect(reason.code).toBe("schema_failure");
      expect(reason.meta.field).toBe("metric");
      expect(reason.meta.type).toBe("invalid_enum_value");
    });

    it("carries the permitted values as data rather than inlining them in prose", async () => {
      // The failure this guards: the permitted values used to be concatenated
      // into the message, which is what made it long enough to be truncated
      // before reaching a model — losing the one part worth having.
      const res = await post({ name: "ok", metric: "nope" });

      const body = await res.json();
      expect(body.reasons[0].meta.expected).toEqual(["latency", "cost"]);
      expect(body.reasons[0].meta.received).toBe("nope");
      expect(body.message).not.toContain("latency");
    });

    it("locates a failure with no path at the root rather than as an empty string", async () => {
      const res = await post([]);

      const body = await res.json();
      expect(body.reasons[0].meta.field).toBe("(root)");
    });

    it("attaches the remediation an agent reads", async () => {
      const res = await post({ name: "", metric: "latency" });

      const body = await res.json();
      expect(body.fault).toBe("customer");
      expect(body.tips.length).toBeGreaterThan(0);
    });
  });

  describe("given a schema that hands its accepted set to a refinement", () => {
    // A catalog lookup (valid evaluator types, real column names) can't be a
    // zod enum, so its failure is a `custom` issue — which knows nothing
    // about what the schema wanted. The schema says so itself via `params`,
    // and the boundary surfaces it exactly like an enum failure: same
    // `meta.expected` / `meta.received`, one shape for every caller.
    const catalog = new Set(["catalog/a", "catalog/b"]);
    const catalogSchema = z.object({
      kind: z.string().superRefine((kind, ctx) => {
        if (!catalog.has(kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unknown kind.",
            params: { expected: [...catalog], received: kind },
          });
        }
      }),
    });

    const appWithCatalog = () => {
      const app = new Hono();
      app.onError(handleError);
      app.post("/", zValidator("json", catalogSchema), (c) =>
        c.json({ ok: true }),
      );
      return app;
    };

    it("carries the refinement's accepted set as meta.expected, like an enum's", async () => {
      const res = await post({ kind: "catalog/nope" }, appWithCatalog());

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.reasons[0].meta.expected).toEqual(["catalog/a", "catalog/b"]);
      expect(body.reasons[0].meta.received).toBe("catalog/nope");
    });

    it("leaves a refinement without params as bare as before", async () => {
      const bareSchema = z.object({
        kind: z.string().refine(() => false, { message: "no" }),
      });
      const app = new Hono();
      app.onError(handleError);
      app.post("/", zValidator("json", bareSchema), (c) => c.json({ ok: true }));

      const res = await post({ kind: "anything" }, app);

      const body = await res.json();
      expect(body.reasons[0].meta.expected).toBeUndefined();
      expect(body.reasons[0].meta.received).toBeUndefined();
    });
  });

  describe("given a body that never parsed at all", () => {
    it("answers 400 with malformed_request, a different failure from a schema one", async () => {
      const res = await post("{ not json");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("malformed_request");
    });

    it("reports no field reasons, because there was no document to have fields", async () => {
      const res = await post("{ not json");

      const body = await res.json();
      expect(body.reasons).toBeUndefined();
    });
  });

  describe("given the route supplies its own hook", () => {
    it("uses the hook's response unchanged", async () => {
      const app = appWith(((_result: unknown, c: { json: Function }) =>
        c.json({ mine: true }, 418)) as never);

      const res = await post({ name: "", metric: "latency" }, app);

      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ mine: true });
    });

    it("still raises the handled error when the hook declines to answer", async () => {
      const app = appWith((() => undefined) as never);

      const res = await post({ name: "", metric: "latency" }, app);

      expect(res.status).toBe(422);
    });
  });

  describe("given a valid body", () => {
    it("passes the parsed value through to the handler", async () => {
      const res = await post({ name: "ok", metric: "cost" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        received: { name: "ok", metric: "cost" },
      });
    });
  });

  describe("given the OpenAPI spec is generated from a route using it", () => {
    it("still publishes the request schema", async () => {
      // hono-openapi hangs the input schema off the middleware as an own symbol
      // property and reads it back at generation time. Wrapping the middleware
      // would silently drop it — the app would keep working and the published
      // API reference would quietly lose every request body.
      const spec = (await generateSpecs(appWith())) as {
        paths: Record<string, Record<string, { requestBody?: unknown }>>;
      };

      expect(spec.paths["/"]?.post?.requestBody).toBeDefined();
    });
  });

  describe("given the handler itself throws after validation passed", () => {
    it("leaves that failure alone rather than calling it malformed", async () => {
      // The guard on the malformed-body catch: it wraps the middleware, so a
      // 400 raised by the ROUTE would be misreported as a parse failure if the
      // wrapper did not track whether the handler had been entered.
      const app = new Hono();
      app.onError(handleError);
      app.post("/", zValidator("json", schema), () => {
        throw Object.assign(new Error("handler said no"), { status: 400 });
      });

      const res = await post({ name: "ok", metric: "cost" }, app);

      expect(res.status).toBe(400);
      expect((await res.json()).error).not.toBe("malformed_request");
    });
  });
});
