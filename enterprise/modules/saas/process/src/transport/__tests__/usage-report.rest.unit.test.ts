// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Both doors of the usage-report receiver through the REST runtime: one
 * operation behind each, a refusal crossing as its code.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import {
  LangWatchCloudOnlyError,
  type IncomingUsageReportRequest,
  type SaasApi,
} from "@langwatch/enterprise-saas-contract";
import { describe, expect, it } from "vitest";

import { usageReportRest } from "../usage-report.rest.ts";

function mount(app: Partial<SaasApi>) {
  return createRestRuntime({
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
  it.each(["/api/track_usage", "/api/v1/connect/stats"])(
    "hands %s's body, unknown fields included, and the sender headers to the receiver",
    async (path) => {
      const received: IncomingUsageReportRequest[] = [];
      const hono = mount({
        receiveUsageReport: (input) => {
          received.push(input);
          return Promise.resolve({ message: "Event captured" });
        },
      });

      const response = await hono.fetch(
        post(path, { ...REPORT, from_the_future: 1 }, { "x-forwarded-for": "203.0.113.7" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: "Event captured" });
      expect(received).toEqual([
        {
          report: { ...REPORT, from_the_future: 1 },
          addressHeaders: expect.objectContaining({ "x-forwarded-for": "203.0.113.7" }),
        },
      ]);
    },
  );

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

    const response = await hono.fetch(post("/api/v1/connect/stats", REPORT));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "langwatch_cloud_only" });
  });
});
