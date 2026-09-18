/**
 * @vitest-environment node
 * Both tracked-event URLs on the in-memory runtime, posted to for real: what a
 * pre-rename SDK release receives is the fact under test, not the declaration.
 */
import { createRestRuntime, HttpError, type RestErrorHandler } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import {
  TRACKED_EVENT_CANONICAL_PATH,
  TRACKED_EVENT_LEGACY_PATH,
  trackedEventLegacyPathRest,
  trackedEventRest,
  type TrackedEventMembers,
} from "../tracked-event.rest.ts";

const PROJECT_ID = "project-1";

/** Stands in for the process boundary: renders the `BadRequestError` the
 * handler throws the same flat `{ error }` shape production's canonical
 * envelope answers for any status-carrying error. */
const renderRefusal: RestErrorHandler = (error, context) =>
  error instanceof HttpError
    ? context.json({ error: error.message }, error.status)
    : context.json({ error: "unhandled" }, 500);

/** Mounts one family and records every event its handler dispatches. */
function mounted(family: typeof trackedEventRest, options: { rejects: boolean }) {
  const recorded: { projectId: string; eventId: string }[] = [];
  const app = createApiFixture<TrackedEventMembers>({
    assertPredefinedEventPayload: () => {
      if (options.rejects) throw new Error("vote out of range");
    },
    generateEventId: () => "generated-event-id",
    recordTrackedEvent: async ({ project, eventId }) => {
      recorded.push({ projectId: project.id, eventId });
    },
    reportError: () => undefined,
    describeValidationError: () => "metrics.vote is outside the allowed range",
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "api-key-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });

  return {
    hono: runtime.mount(family.router(), {
      app: () => app,
      onError: renderRefusal,
    }),
    recorded,
  };
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    trace_id: "trace-1",
    event_type: "thumbs_up_down",
    metrics: { vote: 1 },
    ...overrides,
  };
}

async function post(
  family: typeof trackedEventRest,
  path: string,
  options: { rejects: boolean; body: Record<string, unknown> },
) {
  const { hono, recorded } = mounted(family, { rejects: options.rejects });
  const response = await hono.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.body),
  });

  return { status: response.status, text: await response.text(), recorded };
}

const URLS = [
  { name: "canonical", family: trackedEventRest, path: TRACKED_EVENT_CANONICAL_PATH },
  { name: "legacy", family: trackedEventLegacyPathRest, path: TRACKED_EVENT_LEGACY_PATH },
] as const;

describe("given the two tracked-event URLs", () => {
  describe("when a pre-rename SDK release posts to the legacy one", () => {
    /** @scenario "The legacy URL reaches the same recorder as the canonical one" */
    it("records the caller's own event id and answers the same confirmation", async () => {
      const body = eventPayload({ event_id: "caller-chosen-id" });
      const canonical = await post(trackedEventRest, TRACKED_EVENT_CANONICAL_PATH, {
        rejects: false,
        body,
      });
      const legacy = await post(trackedEventLegacyPathRest, TRACKED_EVENT_LEGACY_PATH, {
        rejects: false,
        body,
      });

      expect(legacy.recorded).toEqual([{ projectId: PROJECT_ID, eventId: "caller-chosen-id" }]);
      expect(legacy.status).toBe(canonical.status);
      expect(legacy.text).toBe(canonical.text);
    });
  });

  describe("when the posted event violates its predefined schema", () => {
    /** @scenario "A rejected event is rejected the same way on both URLs" */
    /** @scenario "A predefined event that violates its schema is rejected, not errored" */
    it("is refused with the offending field and recorded by neither URL", async () => {
      for (const { name, family, path } of URLS) {
        const answer = await post(family, path, { rejects: true, body: eventPayload() });

        expect({ name, status: answer.status }).toEqual({ name, status: 400 });
        expect(answer.text).toContain("vote");
        expect(answer.recorded).toEqual([]);
      }
    });
  });
});
