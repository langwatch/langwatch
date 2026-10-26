/**
 * The generator mounts each installed family from its declaration alone.
 * @see specs/api-reference/openapi-document-generation.feature
 */
import { defineMiddlewareContext, defineRestRouter } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { describedRestApplication } from "../openapi-document.ts";

interface ReportApi {
  read(input: { id: string }): Promise<{ id: string }>;
}

const ReportApi = moduleApi<ReportApi>()("ops");

const reports = defineRestRouter(ReportApi)
  .withNamespace("superseded-reports")
  .withVersion("2026-09-08")
  .withDeprecated({
    successor: "/api/v1/reports",
    when: defineMiddlewareContext("reportsSuperseded", z.boolean()),
  })
  .get("/:id", "getSupersededReport")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.read({ id: input.id }))
  .build();

describe("the generator mounting a family deprecated per request", () => {
  /** @scenario "The generator mounts a family deprecated per request" */
  it("mounts it although no route names the context its deprecation asks", () => {
    const app = describedRestApplication([
      { transports: [{ protocol: "rest", router: () => reports.router() }] },
    ]);

    expect(app.routes.some(({ path }) => path.includes("superseded-reports"))).toBe(true);
  });
});
