/**
 * @vitest-environment node
 * @unit
 * Metadata assertion (idempotent) + milestone (guarded) + reconciliation (unguarded).
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  type ProjectMetadataSubscriberDeps,
  createProjectMetadataHandler,
} from "../project-metadata.subscriber.ts";
import {
  TENANT_ID,
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

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
      findById: async () => ({ ...project }),
      updateMetadata: async ({ data }: { id: string; data: Record<string, unknown> }) => {
        writes.push(data);
        Object.assign(project, data);
      },
      resolveOrgAdmin: async () => ({ userId: "user-1" }),
    },
  };
}

const event = createSpanReceivedEvent(createOtlpSpan());
const foldState = createFoldState({
  attributes: { "langwatch.origin": "application", "sdk.language": "python" },
});

// Typed from the dependency it stands in for, so a change to the command's shape
// fails here at the injection rather than being absorbed by a bare `vi.fn()`.
let recordSignal: Mock<ProjectMetadataSubscriberDeps["nurturing"]["recordSignal"]>;

beforeEach(() => {
  recordSignal = vi.fn(async () => undefined);
});

describe("given a project receiving its first real trace", () => {
  describe("when the same event is handled twice", () => {
    let writes: unknown;

    beforeEach(async () => {
      const store = makeProjectStore({ firstMessage: false, integrated: false });
      writes = store.writes;
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        nurturing: { recordSignal },
      });

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));
    });

    it("records the integration milestone once", async () => {
      expect(recordSignal).toHaveBeenCalledWith({
        kind: "first_trace_integrated",
        sourceEventId: event.id,
        tenantId: TENANT_ID,
        occurredAt: event.occurredAt,
        userId: "user-1",
        projectId: TENANT_ID,
        sdkLanguage: "python",
        sdkFramework: "unknown",
      });
      expect(
        recordSignal.mock.calls.filter(([signal]) => signal.kind === "first_trace_integrated"),
      ).toHaveLength(1);
    });

    // The raw redelivery of the very event that just flipped firstMessage
    // reads the flag as already set on its second pass, so it also tells
    // nurturing a later trace for the same physical trace: an accepted
    // edge case bounded by nurturing's own per-kind idempotency, not by
    // this level-triggered handler (see the handoff's Risks).
    it("also tells nurturing a later trace on the redelivered pass", async () => {
      expect(
        recordSignal.mock.calls.filter(([signal]) => signal.kind === "trace_received"),
      ).toHaveLength(1);
    });

    it("writes the metadata once, because the second delivery finds it set", async () => {
      expect(writes).toEqual([{ firstMessage: true, integrated: true, language: "python" }]);
    });
  });

  describe("when the first delivery's write is lost before the second", () => {
    /**
     * The level-triggered half: the subscriber re-reads the project rather
     * than remembering it ran, so a lost write re-asserts the same values —
     * what makes a redelivery safe without a dedup key.
     */
    it("re-asserts the same metadata", async () => {
      const store = makeProjectStore({ firstMessage: false, integrated: false });
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        nurturing: { recordSignal },
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
  let store: ReturnType<typeof makeProjectStore>;

  beforeEach(async () => {
    store = makeProjectStore({ firstMessage: true, integrated: true });
    const handler = createProjectMetadataHandler({
      projects: store.projects as never,
      nurturing: { recordSignal },
    });

    await handler(event, createContext(foldState));
    await handler(event, createContext(foldState));
  });

  it("records no first_trace_integrated milestone on any delivery", () => {
    expect(recordSignal).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "first_trace_integrated" }),
    );
    expect(store.writes).toHaveLength(0);
  });

  /** @scenario "A later trace tells nurturing against the organization's admin" */
  it("tells nurturing a later trace on every delivery; nurturing's own key collapses the redelivery", () => {
    expect(recordSignal).toHaveBeenCalledTimes(2);
    expect(recordSignal).toHaveBeenCalledWith({
      kind: "trace_received",
      sourceEventId: event.id,
      tenantId: TENANT_ID,
      occurredAt: event.occurredAt,
      userId: "user-1",
      projectId: TENANT_ID,
    });
  });

  describe("when a clustering bootstrap is wired", () => {
    /**
     * Deliberately unguarded: the reconciliation path, so a project that
     * lost its schedule gets it back on its next trace. Rate-limited, so
     * the repeat costs at most one commit per project per claim window.
     */
    it("re-asserts the clustering schedule on every delivery", async () => {
      const store = makeProjectStore({ firstMessage: true, integrated: true });
      const bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        nurturing: { recordSignal },
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
      nurturing: { recordSignal },
    });
    const sample = createFoldState({ attributes: { "langwatch.origin": "sample" } });

    await handler(event, createContext(sample));
    await handler(event, createContext(sample));

    expect(store.writes).toHaveLength(0);
    expect(recordSignal).not.toHaveBeenCalled();
  });
});
