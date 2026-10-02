/**
 * A REST route whose handler answers a shape its output schema refuses.
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

interface ThingApi {
  read(): Promise<{ id: string }>;
}

const ThingApi = moduleApi<ThingApi>()("annotation");

const things = defineRestRouter(ThingApi)
  .withNamespace("things")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .get("/one", "readOne")
  .withAccess(publicRoute({ reason: "the route's own answer is what is under test" }))
  .withOutput(z.object({ id: z.string() }))
  .handle(({ app }) => app.read())
  .build();

describe("given a route whose handler answers a shape its output schema refuses", () => {
  /** @scenario "A procedure whose answer breaks its output schema refuses rather than answering" */
  it("answers an internal error and never the handler's value", async () => {
    const runtime = createRestRuntime({
      identity: { authenticate: () => ({ actor: null, scope: null }) },
    });

    const app = runtime.mount(things.router(), {
      // @ts-expect-error the stub answers a shape the declaration refuses, on purpose
      app: () => ({ read: async () => ({ id: 7, secret: "stored-value" }) }),
      credential: "public",
      onError: createErrorHandler(),
    });

    const response = await app.request("/api/v1/things/one");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("stored-value");
  });
});
