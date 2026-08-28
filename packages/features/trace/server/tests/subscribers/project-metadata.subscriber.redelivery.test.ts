/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `projectMetadata` subscriber, required by the
 * `eventing-subscriber-idempotency` architecture rule.
 *
 * This subscriber is LEVEL-TRIGGERED rather than idempotent by key: it asserts
 * the project's metadata from whichever trace happens to carry it, so running
 * it twice asserts the same state twice. Two effects need pinning separately.
 *
 * The metadata write is a full assertion (`firstMessage`, `integrated`,
 * `language`), so a redelivery writes the same values. It is also skipped once
 * both flags are already set, so a redelivery against the project it just
 * updated does not write at all.
 *
 * The `first_trace_integrated` product event is NOT an assertion — it is a
 * milestone, and sending it twice would double-count integrations. It is
 * guarded on the project's PRE-write `firstMessage`, so the redelivery that
 * reads the updated project never fires it again.
 *
 * The clustering bootstrap is deliberately NOT guarded: it is the
 * reconciliation path, and the injected implementation is rate-limited.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectMetadataHandler } from "../../src/subscribers/project-metadata.subscriber";
import {
  createContext,
  createFoldState,
  createTraceEvent,
  TENANT_ID,
} from "./support/trace-subscriber.fixtures";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/**
 * A project store that behaves like the real one: `updateMetadata` is what a
 * later `tryGetById` reads back, so the second delivery sees the first
 * delivery's write the way a redelivery in production does.
 */
function makeProjectStore(initial: { firstMessage: boolean; integrated: boolean }) {
  const project = { id: TENANT_ID, ...initial };
  const writes: Record<string, unknown>[] = [];
  return {
    project,
    writes,
    projects: {
      tryGetById: async () => ({ ...project }),
      updateMetadata: async ({ data }: { id: string; data: Record<string, unknown> }) => {
        writes.push(data);
        Object.assign(project, data);
      },
      resolveOrgAdmin: async () => ({ userId: "user-1" }),
    },
  };
}

const event = createTraceEvent("lw.obs.trace.span_received");
const foldState = createFoldState({
  attributes: { "langwatch.origin": "application", "sdk.language": "python" },
});

let recordProductEvent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  recordProductEvent = vi.fn();
});

describe("given a project receiving its first real trace", () => {
  describe("when the same event is handled twice", () => {
    it("records the integration milestone once", async () => {
      const store = makeProjectStore({ firstMessage: false, integrated: false });
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        recordProductEvent,
      });

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(recordProductEvent).toHaveBeenCalledTimes(1);
      expect(recordProductEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "first_trace_integrated",
        properties: { sdk_language: "python", sdk_framework: "unknown" },
        projectId: TENANT_ID,
      });
    });

    it("writes the metadata once, because the second delivery finds it set", async () => {
      const store = makeProjectStore({ firstMessage: false, integrated: false });
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        recordProductEvent,
      });

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(store.writes).toEqual([{ firstMessage: true, integrated: true, language: "python" }]);
    });
  });

  describe("when the first delivery's write is lost before the second", () => {
    /**
     * The level-triggered half: the subscriber does not remember that it ran,
     * it re-reads the project. A lost write is re-asserted to the same values
     * rather than to different ones, which is what makes a redelivery safe
     * without a dedup key.
     */
    it("re-asserts the same metadata", async () => {
      const store = makeProjectStore({ firstMessage: false, integrated: false });
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        recordProductEvent,
      });

      await handler(event, createContext(foldState));
      store.project.firstMessage = false;
      store.project.integrated = false;
      await handler(event, createContext(foldState));

      expect(store.writes[1]).toEqual(store.writes[0]);
    });
  });
});

describe("given a project that was already integrated", () => {
  it("records no milestone on any delivery", async () => {
    const store = makeProjectStore({ firstMessage: true, integrated: true });
    const handler = createProjectMetadataHandler({
      projects: store.projects as never,
      recordProductEvent,
    });

    await handler(event, createContext(foldState));
    await handler(event, createContext(foldState));

    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(store.writes).toHaveLength(0);
  });

  describe("when a clustering bootstrap is wired", () => {
    /**
     * Deliberately unguarded, and the comment on `assertClusteringSchedule`
     * says why: it is the reconciliation path, so a project that lost its
     * schedule gets it back on its next trace rather than waiting for an
     * operator. The injected implementation is rate-limited, so the repeat
     * costs at most one commit per project per claim window.
     */
    it("re-asserts the clustering schedule on every delivery", async () => {
      const store = makeProjectStore({ firstMessage: true, integrated: true });
      const bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        recordProductEvent,
        bootstrapTopicClustering,
      });

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));

      expect(bootstrapTopicClustering).toHaveBeenCalledTimes(2);
      expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
    });
  });
});

describe("given a seeded sample trace", () => {
  it("changes nothing, however many times it is delivered", async () => {
    const store = makeProjectStore({ firstMessage: false, integrated: false });
    const handler = createProjectMetadataHandler({
      projects: store.projects as never,
      recordProductEvent,
    });
    const sample = createFoldState({ attributes: { "langwatch.origin": "sample" } });

    await handler(event, createContext(sample));
    await handler(event, createContext(sample));

    expect(store.writes).toHaveLength(0);
    expect(recordProductEvent).not.toHaveBeenCalled();
  });
});
