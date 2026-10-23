/** @vitest-environment node */

import { moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import type { MountableTransport } from "../../hosting/transport-hosts.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";

const logged = vi.hoisted(() => ({ records: [] as Array<{ fields: unknown; message: string }> }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name !== "langwatch:api:hono") return logger;
      const record = (fields: unknown, message: string) => logged.records.push({ fields, message });
      return Object.assign(Object.create(logger), { error: record, warn: record, info: record });
    },
  };
});

const Api = moduleApi<{ ping(): void }>()("langy");

function forwardingRoute(status: number) {
  return defineRestRouter(Api)
    .withNamespace("probe")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })
    .get("/probe/canary", "canary")
    .withAccess(publicRoute({ reason: "a probe answers before anyone signs in" }))
    .withResponse("forwarded", { because: "the canary's own answer is the probe's answer" })
    .handle(({ response }) => response.pass(new Response("canary said no", { status })))
    .build();
}

function rawForwardingRoute(status: number) {
  return defineRestRouter(Api)
    .withNamespace("probe")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })
    .get("/probe/canary", "canary")
    .withAccess(publicRoute({ reason: "a probe answers before anyone signs in" }))
    .withRawResponse({ produces: "text/plain" })
    .handle(() => new Response("canary said no", { status }))
    .build();
}

function hostServing(transport: MountableTransport) {
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
  host.mount(transport, () => ({ ping: () => undefined }));
  return host;
}

describe("a route that forwards another service's answer", () => {
  beforeEach(() => {
    logged.records.length = 0;
  });

  /** @scenario "A forwarded server failure names its status as the cause, never its body" */
  it.each([
    ["a forwarded-kind route", () => hostServing(forwardingRoute(503).router())],
    ["a raw-response route", () => hostServing(rawForwardingRoute(503).router())],
  ])("logs %s's 5xx with its status as the cause", async (_kind, host) => {
    const response = await host().app.request("/probe/canary");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("canary said no");
    const failure = logged.records.find(({ fields }) => JSON.stringify(fields).includes("503"));
    expect(JSON.stringify(failure?.fields)).toContain("ForwardedServerError");
    expect(JSON.stringify(logged.records)).not.toContain("canary said no");
  });
});
