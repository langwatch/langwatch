import { moduleApi } from "@langwatch/kernel";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime, type RestIdentity } from "../runtime.ts";

interface WidgetApi {
  act(input: object): Promise<{ ok: boolean }>;
}

const WidgetApi = moduleApi<WidgetApi>()("api-key");

const application: WidgetApi = { act: async () => ({ ok: true }) };

const widgets = defineRestRouter(WidgetApi)
  .withNamespace("widgets")
  .withVersion("2026-09-25")
  .withCredential("organization")

  .post("/:id/archive", "archiveWidget")
  .withParams(z.object({ id: z.string() }))
  .withInput(z.object({}))
  .withPermission("organization:manage")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(async ({ app, input }) => app.act(input))

  .post("/:id/pause", "pauseWidget")
  .withParams(z.object({ id: z.string() }))
  .withInput(z.object({ reason: z.string().optional() }))
  .withPermission("organization:manage")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(async ({ app, input }) => app.act(input))

  .post("/", "createWidget")
  .withInput(z.object({ name: z.string() }))
  .withPermission("organization:manage")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(async ({ app, input }) => app.act(input))
  .build();

const organizationDoor: RestIdentity = {
  authenticate: () => ({
    actor: { type: "user", id: "user-1" },
    scope: { tier: "organization", id: "organization-1" },
  }),
};

type PublishedBody = Readonly<{ required?: boolean }> | undefined;

async function publishedBodies(): Promise<Record<string, PublishedBody>> {
  const app = createRestRuntime({ identity: organizationDoor }).mount(widgets.router(), {
    app: () => application,
    credential: "organization",
    onError: createErrorHandler(),
  });
  const document = JSON.parse(JSON.stringify(await generateSpecs(app))) as {
    paths: Record<string, { post?: { operationId?: string; requestBody?: PublishedBody } }>;
  };

  return Object.fromEntries(
    Object.values(document.paths).flatMap((item) =>
      item.post?.operationId ? [[item.post.operationId, item.post.requestBody]] : [],
    ),
  );
}

describe("the request body a mounted route publishes", () => {
  describe("given an action whose declared input is an empty object", () => {
    it("publishes no request body", async () => {
      expect((await publishedBodies()).archiveWidget).toBeUndefined();
    });
  });

  describe("given an input the runtime reads as empty when the body is absent", () => {
    it("publishes the body as optional", async () => {
      expect((await publishedBodies()).pauseWidget).toMatchObject({ required: false });
    });
  });

  describe("given an input with a required field", () => {
    it("publishes the body as required", async () => {
      expect((await publishedBodies()).createWidget).toMatchObject({ required: true });
    });
  });
});
