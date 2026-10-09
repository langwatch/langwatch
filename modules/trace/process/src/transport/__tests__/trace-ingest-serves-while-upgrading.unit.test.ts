/**
 * @vitest-environment node
 * Trace ingestion passes the holding door while the installation upgrades (API-UP-DURING-UPGRADE).
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { routesHeldWhileUpgrading } from "@langwatch/api";
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { collectorRest } from "../collector.rest.ts";
import { otlpIngestRest } from "../otlp-ingest.rest.ts";
import { trackedEventLegacyPathRest, trackedEventRest } from "../tracked-event.rest.ts";

function mountIngest(): (route: string) => boolean {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  const notCalled = (): never => {
    throw new Error("no request reaches the door here");
  };
  for (const rest of [
    otlpIngestRest,
    collectorRest,
    trackedEventRest,
    trackedEventLegacyPathRest,
  ]) {
    host.mount(rest.router(), notCalled);
  }
  const held = routesHeldWhileUpgrading().map((source) => new RegExp(source));

  return (route) => !held.some((pattern) => pattern.test(route));
}

describe("given the installation upgrading", () => {
  /** @scenario "An SDK posting traces while the installation upgrades is answered by the api" */
  it("passes every trace ingest route and the trace reads", () => {
    const passes = mountIngest();

    expect(passes("POST /api/otel/v1/traces")).toBe(true);
    expect(passes("POST /api/otel/custom/v1/traces")).toBe(true);
    expect(passes("POST /v1/traces")).toBe(true);
    expect(passes("POST /api/collector")).toBe(true);
    expect(passes("POST /api/events/track")).toBe(true);
    expect(passes("POST /api/track_event")).toBe(true);
    expect(passes("GET /api/otel/v1/traces")).toBe(true);
    expect(passes("GET /api/traces")).toBe(true);
  });
});
