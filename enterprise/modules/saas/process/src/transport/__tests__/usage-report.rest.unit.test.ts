import {
  bindMiddlewareContext,
  callerAddressContext,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
} from "@langwatch/api/rest";
import {
  LangWatchCloudOnlyError,
  type IncomingUsageReportRequest,
  type SaasApi,
} from "@langwatch/enterprise-saas-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Both doors of the usage-report receiver through the REST runtime: one
 * operation behind each, a refusal crossing as its code.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { usageReportRest } from "../usage-report.rest.ts";

function mount(app: Partial<SaasApi>, callerAddress: string | null = "203.0.113.7") {
  return createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the usage-report receiver reads no credential");
      },
    },
  }).mount(usageReportRest.router(), {
    app: () => createApiFixture<SaasApi>(app),
    credential: "public",
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:usage-report",
      label: "Usage report",
    }),
    middlewareContext: [bindMiddlewareContext(callerAddressContext, () => callerAddress)],
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const REPORT = { event: "daily_usage_stats", instance_id: "install-1", version: "3.1.0" };

describe("the usage-report receiver's doors", () => {
  /** @scenario "Both doors hand the report to the same operation" */
  /** @scenario "An install on an older version still reaches the old statistics route" */
  it.each(["/api/track_usage", "/api/connect/v1/stats"])(
    "hands %s's body, unknown fields included, and the resolved sender address to the receiver",
    async (path) => {
      const received: IncomingUsageReportRequest[] = [];
      const hono = mount({
        receiveUsageReport: (input) => {
          received.push(input);
          return Promise.resolve({ message: "Event captured" });
        },
      });

      const response = await hono.fetch(post(path, { ...REPORT, from_the_future: 1 }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: "Event captured" });
      expect(received).toEqual([
        {
          report: { ...REPORT, from_the_future: 1 },
          callerAddress: "203.0.113.7",
        },
      ]);
    },
  );

  /** @scenario "The usage-report receiver limits on the resolved address" */
  it("hands the resolved address, not a forged forwarding header, to the per-address limit", async () => {
    const received: IncomingUsageReportRequest[] = [];
    const hono = mount(
      {
        receiveUsageReport: (input) => {
          received.push(input);
          return Promise.resolve({ message: "Event captured" });
        },
      },
      "203.0.113.9",
    );

    await hono.fetch(
      post("/api/track_usage", REPORT, {
        "cf-connecting-ip": "198.51.100.1",
        "true-client-ip": "198.51.100.2",
        "x-forwarded-for": "198.51.100.3",
        "x-real-ip": "198.51.100.4",
      }),
    );

    expect(received.map((input) => input.callerAddress)).toEqual(["203.0.113.9"]);
  });

  /** @scenario "A report without an install id is refused before the receiver runs" */
  it("refuses a body without an install id before the receiver runs", async () => {
    const received: IncomingUsageReportRequest[] = [];
    const hono = mount({
      receiveUsageReport: (input) => {
        received.push(input);
        return Promise.resolve({ message: "Event captured" });
      },
    });

    const response = await hono.fetch(post("/api/track_usage", { event: "daily_usage_stats" }));

    expect(await response.json()).toMatchObject({ code: "validation_error" });
    expect(received).toEqual([]);
  });

  /** @scenario "Any other deployment refuses Cloud's routes by code" */
  it("answers the cloud-only refusal by its code", async () => {
    const hono = mount({
      receiveUsageReport: () => Promise.reject(new LangWatchCloudOnlyError()),
    });

    const response = await hono.fetch(post("/api/connect/v1/stats", REPORT));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "langwatch_cloud_only" });
  });
});
