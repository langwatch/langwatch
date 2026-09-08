import { describe, expect, it } from "vitest";
import { z } from "zod";
import { featureApi } from "@langwatch/runtime-composition";

import { defineRestRouter } from "../rest-router.ts";

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
