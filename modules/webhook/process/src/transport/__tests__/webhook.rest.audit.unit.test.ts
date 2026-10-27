/**
 * @vitest-environment node
 * Sensitive management writes carry a declared audit action; reads and ingest carry none.
 */
import { describe, expect, it } from "vitest";

import { webhookRest } from "../webhook.rest.ts";

describe("the management REST audit declaration", () => {
  it("webhook.rest audits its sensitive writes under their management action", () => {
    const audited = webhookRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["postApiWebhooksV1Endpoints", "management.webhook-endpoints.create"],
        ["deleteApiWebhooksV1EndpointsById", "management.webhook-endpoints.archive"],
        ["postApiWebhooksV1EndpointsByIdRollSecret", "management.webhook-endpoints.roll-secret"],
      ]),
    );
  });
});
