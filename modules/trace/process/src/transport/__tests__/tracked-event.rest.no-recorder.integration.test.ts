/**
 * @vitest-environment node
 * Both tracked-event URLs mounted over a real TraceModule whose process has no span
 * recorder: the refusal reaches the caller by name instead of a 200 (parity Trace 9).
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceModule, type TraceAppDependencies } from "../../app/trace.app.ts";
import type { TraceLegacyRead } from "../../services/trace-viewer.service.ts";
import {
  TRACKED_EVENT_CANONICAL_PATH,
  TRACKED_EVENT_LEGACY_PATH,
  trackedEventLegacyPathRest,
  trackedEventRest,
} from "../tracked-event.rest.ts";

const PROJECT_ID = "project-1";

/** A TraceModule built with no span ingest: what a process without a recorder holds. */
function moduleWithoutRecorder() {
  return TraceModule.fromDependencies(
    createApiFixture<TraceAppDependencies>({
      spanIngest: undefined,
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

async function post({ family, path }: { family: typeof trackedEventRest; path: string }) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "api-key-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });
  const app = moduleWithoutRecorder();
  const hono = runtime.mount(family.router(), { app: () => app, onError: canonicalErrorResponse });
  const response = await hono.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      trace_id: "trace-1",
      event_type: "thumbs_up_down",
      metrics: { vote: 1 },
      event_id: "caller-chosen-id",
    }),
  });

  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const URLS = [
  { name: "canonical", family: trackedEventRest, path: TRACKED_EVENT_CANONICAL_PATH },
  { name: "legacy", family: trackedEventLegacyPathRest, path: TRACKED_EVENT_LEGACY_PATH },
] as const;

describe("given a process with no tracked-event recorder", () => {
  describe("when a valid event is posted to either tracked-event URL", () => {
    /** @scenario "Both tracked-event URLs refuse by name when the process has no recorder" */
    it("answers the named 503 refusal rather than the confirmation", async () => {
      for (const { name, family, path } of URLS) {
        const answer = await post({ family, path });

        expect({ name, status: answer.status }).toEqual({ name, status: 503 });
        // The §12 5xx mask carries a platform fault as `internal_error` (held question CH-1).
        expect({ name, code: answer.body.code }).toEqual({ name, code: "internal_error" });
        expect(answer.body.message).not.toBe("Event tracked");
      }
    });
  });
});
