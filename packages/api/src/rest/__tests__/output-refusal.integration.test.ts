/**
 * A REST route whose handler answers a shape its output schema refuses.
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { moduleApi } from "@langwatch/module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const logged: { fields: Record<string, unknown>; message: string }[] = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = (await importOriginal()) as { createLogger: (name: string) => object };

  return {
    ...actual,
    createLogger: (name: string) => ({
      ...actual.createLogger(name),
      error: (fields: Record<string, unknown>, message: string) => {
        logged.push({ fields, message });
      },
    }),
  };
});

beforeEach(() => {
  logged.length = 0;
});

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
  /** @scenario "A procedure whose answer breaks its output schema is logged and still answered" */
  it("answers the handler's value without what the schema does not allow", async () => {
    const runtime = createRestRuntime({
      authorization: authorizationPort,
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

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({});
    expect(body).not.toContain("stored-value");
  });
});

interface ReportApi {
  check(): Promise<unknown>;
}

const ReportApi = moduleApi<ReportApi>()("annotation");

const report = z.object({ status: z.string() }).strict();

const reports = defineRestRouter(ReportApi)
  .withNamespace("reports")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .get("/", "readReport")
  .withAccess(publicRoute({ reason: "the route's own answer is what is under test" }))
  .responds({ 200: report, 503: report })
  // The stub answers bodies the 503 schema refuses, on purpose: that drift is what is under test.
  .handle(async ({ app }) => ({ status: 503, body: (await app.check()) as never }) as const)
  .build();

function reportApp(body: unknown) {
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: { authenticate: () => ({ actor: null, scope: null }) },
  });

  return runtime.mount(reports.router(), {
    app: () => ({ check: async () => body }),
    credential: "public",
    onError: createErrorHandler(),
  });
}

describe("given a responds() route whose body its declared status schema refuses", () => {
  /** @scenario "A procedure whose answer breaks its output schema is logged and still answered" */
  it("answers the declared status with the body cut to the keys the schema names", async () => {
    const response = await reportApp({ status: "down", secret: "stored-value" }).request(
      "/api/v1/reports",
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "down" });
    expect(body).not.toContain("stored-value");
    expect(logged[0]?.fields).toMatchObject({ path: "/api/v1/reports", status: 503 });
    expect(JSON.stringify(logged)).not.toContain("stored-value");
  });

  it("answers the declared status with no body when the schema leaves nothing", async () => {
    const response = await reportApp([{ secret: "stored-value" }]).request("/api/v1/reports");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
