/**
 * @vitest-environment node
 * A refused credential driven through the REST host: span and request log as a request sees them.
 */
import { moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { ProjectInvalidCredentialsError } from "../../errors.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { resetClientFaultLog } from "../client-fault-telemetry.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

type Line = { level: string; fields: Record<string, unknown>; message: string };
const logged = vi.hoisted(() => ({ lines: [] as Line[] }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  const capture =
    (level: string) =>
    (fields: Record<string, unknown>, message: string): void => {
      logged.lines.push({ level, fields, message });
    };
  return {
    ...actual,
    createLogger: (name: string) =>
      Object.assign(Object.create(actual.createLogger(name)), {
        error: capture("error"),
        warn: capture("warn"),
        info: capture("info"),
        debug: capture("debug"),
      }),
  };
});

const Api = moduleApi<{ read(): { ok: boolean } }>()("langy");
const declaration = defineRestRouter(Api)
  .withNamespace("internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("internal_secret")
  .get("/internal/read", "internal")
  .withAccess(anyAuthenticated({ reason: "module-owned internal credential" }))
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

function hostRefusing() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });
  const read = () => {
    throw new ProjectInvalidCredentialsError();
  };
  host.mount(declaration.router(), () => ({ read }), {
    middlewareBindings: [
      bindRestCredential("internal_secret", () =>
        BearerIdentity.create({ name: "internal", token: "internal-marker" }),
      ),
    ],
  });
  return host;
}

const exporter = new InMemorySpanExporter();
const headers = { authorization: "Bearer internal-marker" };

describe("a REST request the caller's credential fails", () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
    );
  });
  afterAll(() => trace.disable());
  beforeEach(() => {
    exporter.reset();
    logged.lines.length = 0;
    resetClientFaultLog();
  });

  /** @scenario A refused credential leaves the request span unset */
  it("leaves the request span unset with the exception and the refusal's code", async () => {
    const response = await hostRefusing().app.request("/internal/read", { headers });

    expect(response.status).toBe(401);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.UNSET);
    expect(spans[0]?.events.map((event) => event.name)).toEqual(["exception"]);
    expect(spans[0]?.attributes).toMatchObject({
      "langwatch.error.code": "invalid_credentials",
      "langwatch.error.fault": "customer",
    });
  });

  /** @scenario A repeated caller fault warns once a minute and counts every request */
  it("logs the first refusal at warn and its repeats in the window at debug", async () => {
    const host = hostRefusing();

    for (let i = 0; i < 3; i++) await host.app.request("/internal/read", { headers });

    const requestLines = logged.lines.filter((line) => line.fields.statusCode === 401);
    expect(requestLines.map((line) => line.level)).toEqual(["warn", "debug", "debug"]);
  });
});
