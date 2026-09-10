/**
 * `/api/events/track` and its `/api/track_event` alias, driven through the
 * real Hono app the mount opens. What matters here is that the alias
 * forwards into the SAME canonical handler rather than reimplementing it.
 */
import type { TrackedEventPorts } from "@langwatch/trace-server";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountTrackedEventRest } from "../tracked-event-rest.mount.ts";
import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime, type ApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";

const PROJECT = { id: "project-1", slug: "acme", teamId: "team-1", organizationId: "org-1" };

const TRACKED_EVENT_BODY = { event_type: "custom_event", trace_id: "trace-1", metrics: {} };

function testRuntime(): ApiRestRuntime {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  return createApiRestRuntime({
    projectCredential: async () => ({
      ok: true as const,
      project: { ...PROJECT, isPersonal: false, ownerUserId: null },
      resolved: {
        type: "apiKey" as const,
        apiKeyId: "key-1",
        userId: null,
        organizationId: PROJECT.organizationId,
        ingestSourceType: null,
        ingestionTemplateId: null,
        project: { ...PROJECT, isPersonal: false, ownerUserId: null },
      },
      markUsed: () => undefined,
    }),
    organizationCredential: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    organizationIdentity: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors,
  });
}

function mount(overrides: Partial<TrackedEventPorts> = {}) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const ports: TrackedEventPorts = {
    assertPredefinedEventPayload: () => undefined,
    generateEventId: () => "event-1",
    recordTrackedEvent: async () => undefined,
    reportError: () => undefined,
    describeValidationError: () => "invalid",
    ...overrides,
  };

  const [canonical, alias] = mountTrackedEventRest(testRuntime(), { ports: () => ports, errors });

  const hono = new Hono();
  hono.route("/", canonical);
  hono.route("/", alias);

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

describe("given the family's older name", () => {
  describe("when a caller posts to /api/track_event", () => {
    it("re-dispatches into the canonical /api/events/track handler", async () => {
      const recordTrackedEvent = vi.fn(async () => undefined);
      const api = mount({ recordTrackedEvent });

      const response = await api.fetch("/api/track_event", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Auth-Token": "test-token" },
        body: JSON.stringify(TRACKED_EVENT_BODY),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "Event tracked" });
      expect(recordTrackedEvent).toHaveBeenCalledTimes(1);
      expect(recordTrackedEvent.mock.calls[0]?.[0]).toMatchObject({
        project: { id: "project-1" },
      });
    });

    it("answers without a redirect, so the body is never dropped", async () => {
      const api = mount();

      const response = await api.fetch("/api/track_event", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Auth-Token": "test-token" },
        body: JSON.stringify(TRACKED_EVENT_BODY),
      });

      expect(response.status).not.toBe(307);
      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("when the canonical route refuses the credential", () => {
    it("refuses the alias the same way, without recording anything", async () => {
      const recordTrackedEvent = vi.fn(async () => undefined);
      const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
      const ports: TrackedEventPorts = {
        assertPredefinedEventPayload: () => undefined,
        generateEventId: () => "event-1",
        recordTrackedEvent,
        reportError: () => undefined,
        describeValidationError: () => "invalid",
      };
      const runtime = createApiRestRuntime({
        projectCredential: async () => ({
          ok: false as const,
          status: 401 as const,
          body: { error: "Unauthorized" },
        }),
        organizationCredential: () => {
          throw new Error("This suite composed no organization credential door.");
        },
        organizationIdentity: () => {
          throw new Error("This suite composed no organization credential door.");
        },
        routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
        errors,
      });

      const [canonical, alias] = mountTrackedEventRest(runtime, { ports: () => ports, errors });
      const hono = new Hono();
      hono.route("/", canonical);
      hono.route("/", alias);

      const response = await hono.fetch(
        new Request("http://api.test/api/track_event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(TRACKED_EVENT_BODY),
        }),
      );

      expect(response.status).toBe(401);
      expect(recordTrackedEvent).not.toHaveBeenCalled();
    });
  });
});
