import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createService } from "../builder.js";

/**
 * An endpoint answers ONE success status. Before this, `serializeEndpointResult`
 * chose between 200 and 204 by looking at what the handler returned, so an
 * `output` schema that accepted `undefined` gave the same operation two shapes:
 * a body on the request that found something, an empty 204 on the one that did
 * not. Callers, the published document and both SDKs each have to pick one.
 *
 * The rule these pin: no `output` (or `z.void()` / `z.undefined()`) means the
 * endpoint never sends a body; any other schema means it always does; a schema
 * that would allow both is refused at registration rather than resolved per
 * request.
 */

const buildTestService = () =>
  createService({ name: "test", basePath: "/api/test" });

describe("endpoint success status", () => {
  describe("given an output schema that accepts undefined as well as a value", () => {
    it("refuses an optional object at registration", () => {
      expect(() =>
        buildTestService().version("2025-03-15", (v) => {
          v.get(
            "/maybe",
            { output: z.object({ id: z.string() }).optional() },
            async () => undefined,
          );
        }),
      ).toThrow(/accepts undefined as well as a value/);
    });

    it("names both statuses it would move between", () => {
      expect(() =>
        buildTestService().version("2025-03-15", (v) => {
          v.post(
            "/maybe",
            { output: z.string().optional(), status: 201 },
            async () => undefined,
          );
        }),
      ).toThrow(/204 when undefined, 201 otherwise/);
    });

    it("refuses an unchecked z.any() output, which accepts both too", () => {
      expect(() =>
        buildTestService().version("2025-03-15", (v) => {
          v.get("/any", { output: z.any() }, async () => undefined);
        }),
      ).toThrow(/accepts undefined as well as a value/);
    });

    it("refuses it on an RPC operation the same way", () => {
      expect(() =>
        buildTestService().version("2025-03-15", (v) => {
          v.rpc(
            "/things.maybe",
            { output: z.object({ id: z.string() }).optional() },
            async () => undefined,
          );
        }),
      ).toThrow(/accepts undefined as well as a value/);
    });
  });

  /**
   * `.default(...)` and `.catch(...)` accept `undefined` and then replace it
   * with a value, so testing acceptance alone refused them for an ambiguity
   * they do not have: `serializeEndpointResult` branches on what the schema
   * PRODUCED, and these never produce `undefined`. The status cannot move, so
   * the registration is legal and the endpoint always answers with a body.
   */
  describe("given an output schema that fills undefined in with a value", () => {
    it("admits a defaulted output and always answers with the default", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/defaulted", { output: z.string().default("filled") }, () =>
            // biome-ignore lint/suspicious/noExplicitAny: the handler returning undefined is the case under test; the type correctly forbids it.
            (undefined as any),
          );
        })
        .build();

      const res = await app.request("/api/test/defaulted");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toBe("filled");
    });

    it("admits a caught output at registration", () => {
      expect(() =>
        buildTestService().version("2025-03-15", (v) => {
          v.get("/caught", { output: z.string().catch("fallback") }, () => "x");
        }),
      ).not.toThrow();
    });
  });

  describe("given a schema whose only accepted value is undefined", () => {
    it("admits z.void() and always answers 204", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/void", { output: z.void() }, async () => undefined);
        })
        .build();

      const res = await app.request("/api/test/2025-03-15/void");
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });

    it("admits z.undefined() and always answers 204", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/nothing", { output: z.undefined() }, async () => undefined);
        })
        .build();

      expect((await app.request("/api/test/2025-03-15/nothing")).status).toBe(
        204,
      );
    });
  });

  describe("given a required output schema", () => {
    it("always answers the declared status, never 204", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.post(
            "/created",
            { output: z.object({ id: z.string() }), status: 201 },
            async () => ({ id: "a" }),
          );
        })
        .build();

      const res = await app.request("/api/test/2025-03-15/created", {
        method: "POST",
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: "a" });
    });

    /**
     * The old undefined branch used `config.status ?? 204` while the value
     * branch used `?? 200`, so a `status: 201` endpoint whose handler returned
     * nothing answered 201 with an empty body — a created response whose own
     * schema promised a representation. Registration now refuses the schema
     * that made it reachable; this pins that a missing body is an error rather
     * than a quietly different status.
     */
    it("fails the request rather than downgrading a missing body to 204", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.post(
            "/created",
            { output: z.object({ id: z.string() }), status: 201 },
            // The cast is the point: a handler that returns nothing where a
            // body is declared.
            async () => undefined as unknown as { id: string },
          );
        })
        .build();

      const res = await app.request("/api/test/2025-03-15/created", {
        method: "POST",
      });
      expect(res.status).toBe(500);
    });
  });

  describe("given no output schema at all", () => {
    /**
     * `Handler` already requires a `Response` when no `output` is declared, so
     * typed code cannot reach this. The cast is what an untyped caller — or a
     * handler whose return type drifted behind an `any` — does by accident, and
     * the rule is that it still cannot put an undeclared, unvalidated payload
     * on the wire: no declared body means no body.
     */
    it("sends no body, whatever the handler returned", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/bare", {}, (async () => ({ leaked: "secret" })) as never);
        })
        .build();

      const res = await app.request("/api/test/2025-03-15/bare");
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });
  });
});
