/**
 * The REST transport's declaration surface and its version vocabulary: what
 * `defineRestRouter` records and refuses, and how a static generation is
 * selected from a path, a header or neither.
 */
import { featureApi } from "@langwatch/runtime-composition";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiVersionConflictError, InvalidApiVersionError } from "../../errors.ts";
import {
  API_VERSION_HEADER,
  defineRestRouter,
  RestVersionSelector,
  restVersionSelectorMiddleware,
} from "../runtime.ts";

describe("defineRestRouter", () => {
  /** @scenario "A REST endpoint is one complete declaration in the server" */
  it("keeps route declarations inert and callable for feature discovery", () => {
    const api = featureApi<{ get(input: { id: string }): Promise<{ id: string }> }>("annotation");

    const transport = defineRestRouter(api)
      .withNamespace("annotations")
      .withVersion("2026-08-07")
      .get("/:id", "getAnnotation")
      .withParams(z.object({ id: z.string() }))
      .withPermission("annotations:view")
      .withOutput(z.object({ id: z.string() }))
      .handle(({ input }) => ({ id: input.id }))

      .delete("/:id", "deleteAnnotation")
      .withParams(z.object({ id: z.string() }))
      .withPermission("annotations:view")
      .handle(async () => {})
      .build();

    const declaration = transport.router();

    expect(declaration).toMatchObject({
      protocol: "rest",
      api,
      namespace: "annotations",
      version: "2026-08-07",
      routes: [{ method: "get" }, { method: "delete" }],
    });

    expect(declaration.routes[1]?.output.safeParse(void 0).success).toBe(true);
  });

  it("rejects conflicting request sources and malformed path parameters", () => {
    const api = featureApi<{ get(input: { id: string }): Promise<{ id: string }> }>("annotation");

    const router = () =>
      defineRestRouter(api).withNamespace("annotations").withVersion("2026-08-07");

    expect(() => {
      const route = router()
        .patch("/:id", "updateAnnotation")
        .withParams(z.object({ id: z.string() }));

      Reflect.apply(route.withInput, route, [z.object({ id: z.string() })]);
    }).toThrow(/declared by multiple sources/);

    expect(() => {
      const route = router()
        .patch("/:id", "updateVariant")
        .withParams(z.object({ id: z.string() }));

      const body = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("text"), text: z.string() }),
        z.object({ kind: z.literal("reference"), id: z.string() }),
      ]);

      Reflect.apply(route.withInput, route, [body]);
    }).toThrow(/declared by multiple sources/);

    expect(() => {
      const dynamicPath = "/:id" as string;
      const route = router().get(dynamicPath, "getAnnotation");
      Reflect.apply(route.withParams, route, [z.object({ annotationId: z.string() })]);
    }).toThrow(/must exactly match/);

    expect(() => {
      const dynamicPath = "/:id" as string;

      router()
        .get(dynamicPath, "missingParams")
        .withPermission("annotations:view")
        .handle(() => {});
    }).toThrow(/must declare withParams/);

    expect(() => {
      const declared = router()
        .get("/annotations", "listAnnotations")
        .withPermission("annotations:view")
        .handle(() => {});

      declared
        .get("/annotations", "listAnnotationsAgain")
        .withPermission("annotations:view")
        .handle(() => {});
    }).toThrow(/already registered/);

    expect(() => defineRestRouter(api).withNamespace("Annotations")).toThrow(/lower kebab case/);
  });
});

describe("RestVersionSelector", () => {
  const selector = RestVersionSelector.create({
    versions: ["v1", "v2"],
    latestVersion: "v2",
  });

  it("uses the explicit path version", () => {
    expect(selector.select({ pathVersion: "v1" })).toEqual({ version: "v1", source: "path" });
  });

  it("uses a supported header when the path is unversioned", () => {
    expect(selector.headerName).toBe(API_VERSION_HEADER);
    expect(selector.select({ headerVersion: "v1" })).toEqual({
      version: "v1",
      source: "header",
    });
  });

  it("uses the configured latest version without a path or header", () => {
    expect(selector.select({})).toEqual({ version: "v2", source: "latest" });
  });

  it("rejects a conflicting explicit path and header", () => {
    expect(() => selector.select({ pathVersion: "v1", headerVersion: "v2" })).toThrow(
      ApiVersionConflictError,
    );
  });

  it.each([{ pathVersion: "v3" }, { headerVersion: "v3" }])(
    "rejects unknown versions: %o",
    (request) => {
      expect(() => selector.select(request)).toThrow(InvalidApiVersionError);
    },
  );

  it("rejects an invalid selector configuration", () => {
    expect(() => RestVersionSelector.create({ versions: [], latestVersion: "v1" })).toThrow(
      /at least one supported version/,
    );
    expect(() => RestVersionSelector.create({ versions: ["v1"], latestVersion: "v2" })).toThrow(
      /latestVersion must be supported/,
    );
  });

  it("applies static selection to a hand-mounted REST route", async () => {
    const app = new Hono()
      .use(
        "*",
        restVersionSelectorMiddleware({
          selector: RestVersionSelector.create({ versions: ["v1"], latestVersion: "v1" }),
        }),
      )
      .get("/things", (context) => context.json({ ok: true }));

    const latest = await app.request("/things");
    const pinned = await app.request("/things", { headers: { "X-API-Version": "v1" } });

    expect(latest.headers.get("X-API-Version")).toBe("v1");
    expect(latest.headers.get("X-API-Version-Status")).toBe("latest");
    expect(pinned.headers.get("X-API-Version-Status")).toBe("stable");
  });
});
