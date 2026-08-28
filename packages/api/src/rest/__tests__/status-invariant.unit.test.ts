import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";

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

const buildTestService = () => createService({ name: "test", basePath: "/api/test" });

describe("endpoint success status", () => {
  describe("given an output schema that accepts undefined as well as a value", () => {
    it("refuses an optional object at registration", () => {
      expect(() =>
        buildTestService().registerRoute(
          "get",
          "/maybe",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.object({ id: z.string() }).optional()),
        ),
      ).toThrow(/accepts undefined as well as a value/);
    });

    it("names both statuses it would move between", () => {
      expect(() =>
        buildTestService().registerRoute(
          "post",
          "/things.maybe",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.string().optional()),
        ),
      ).toThrow(/204 when undefined, 200 otherwise/);
    });

    it("names the declared status when one is configured", () => {
      expect(() =>
        buildTestService().registerRoute(
          "post",
          "/things.maybe",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.string().optional()).withStatus(201),
        ),
      ).toThrow(/204 when undefined, 201 otherwise/);
    });

    it("refuses an unchecked z.any() output, which accepts both too", () => {
      expect(() =>
        buildTestService().registerRoute(
          "get",
          "/any",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.any()),
        ),
      ).toThrow(/accepts undefined as well as a value/);
    });

    it("refuses it on a POST operation the same way", () => {
      expect(() =>
        buildTestService().registerRoute(
          "post",
          "/things.maybe",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.object({ id: z.string() }).optional()),
        ),
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
        .registerRoute(
          "get",
          "/defaulted",
          "2025-03-15",
          // biome-ignore lint/suspicious/noExplicitAny: the handler returning undefined is the case under test; the type correctly forbids it.
          () => undefined as any,
          (b) => b.withOutput(z.string().default("filled")),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/defaulted");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toBe("filled");
    });

    it("admits a caught output at registration", () => {
      expect(() =>
        buildTestService().registerRoute(
          "get",
          "/caught",
          "2025-03-15",
          () => "x",
          (b) => b.withOutput(z.string().catch("fallback")),
        ),
      ).not.toThrow();
    });
  });

  describe("given a schema whose only accepted value is undefined", () => {
    it("admits z.void() and always answers 204", async () => {
      const app = buildTestService()
        .registerRoute(
          "get",
          "/void",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.void()),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/void");
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });

    it("admits z.undefined() and always answers 204", async () => {
      const app = buildTestService()
        .registerRoute(
          "get",
          "/nothing",
          "2025-03-15",
          async () => undefined,
          (b) => b.withOutput(z.undefined()),
        )
        .build();

      expect((await app.request("/api/test/2025-03-15/nothing")).status).toBe(204);
    });
  });

  describe("given a required output schema", () => {
    it("always answers 200, never 204", async () => {
      const app = buildTestService()
        .registerRoute(
          "post",
          "/things.create",
          "2025-03-15",
          async () => ({ id: "a" }),
          (b) => b.withOutput(z.object({ id: z.string() })),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/things.create", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "a" });
    });

    it("always answers the declared status when one is configured", async () => {
      const app = buildTestService()
        .registerRoute(
          "post",
          "/things.create",
          "2025-03-15",
          async () => ({ id: "a" }),
          (b) => b.withOutput(z.object({ id: z.string() })).withStatus(201),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/things.create", {
        method: "POST",
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: "a" });
    });

    /**
     * Registration refuses the schema that would let the status move, so a
     * missing body is an error rather than a quietly different status.
     */
    it("fails the request rather than downgrading a missing body to 204", async () => {
      const app = buildTestService()
        .registerRoute(
          "post",
          "/things.create",
          "2025-03-15",
          // The cast is the point: a handler that returns nothing where a
          // body is declared.
          async () => undefined as unknown as { id: string },
          (b) => b.withOutput(z.object({ id: z.string() })),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/things.create", {
        method: "POST",
      });
      expect(res.status).toBe(500);
    });
  });

  describe("given no output schema at all", () => {
    it("refuses the REST route at registration", () => {
      const service = buildTestService();

      expect(() =>
        Reflect.apply(service.registerRoute, service, [
          "get",
          "/bare",
          "2025-03-15",
          async () => ({ leaked: "secret" }),
        ]),
      ).toThrow(/must declare an output schema/);
    });

    it("refuses a hand-built response from a schema-backed route", async () => {
      const app = buildTestService()
        .registerRoute(
          "get",
          "/response",
          "2025-03-15",
          async () => new Response("not validated"),
          (b) => b.withOutput(z.string()),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/response");

      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("not validated");
    });

    it("refuses a raw Response from a handler that declared an output", async () => {
      const app = buildTestService()
        .registerRoute(
          "post",
          "/things.download",
          "2025-03-15",
          async () =>
            new Response("raw bytes", {
              headers: { "content-type": "application/octet-stream" },
              status: 206,
            }) as unknown as string,
          (b) => b.withOutput(z.string()),
        )
        .build();

      const res = await app.request("/api/test/2025-03-15/things.download", {
        method: "POST",
      });

      expect(res.status).toBe(500);
    });
  });
});
