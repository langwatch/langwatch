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

// Typed from the dependency it stands in for, so a change to the sink's shape
// fails here at the injection rather than being absorbed by a bare `vi.fn()`.
// (It does not tighten `toHaveBeenCalledWith`, which still accepts an argument
// carrying fields the signature does not declare.)
let recordProductEvent: Mock<ProjectMetadataSubscriberDeps["recordProductEvent"]>;

beforeEach(() => {
  recordProductEvent = vi.fn();
});

describe("given a project receiving its first real trace", () => {
  describe("when the same event is handled twice", () => {
    let writes: unknown;

    beforeEach(async () => {
      const store = makeProjectStore({ firstMessage: false, integrated: false });
      writes = store.writes;
      const handler = createProjectMetadataHandler({
        projects: store.projects as never,
        recordProductEvent,
      });

      await handler(event, createContext(foldState));
      await handler(event, createContext(foldState));
    });

    it("records the integration milestone once", async () => {
      expect(recordProductEvent).toHaveBeenCalledTimes(1);
      expect(recordProductEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "first_trace_integrated",
        properties: { sdk_language: "python", sdk_framework: "unknown" },
        projectId: TENANT_ID,
      });
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
     * Deliberately unguarded: the reconciliation path, so a project that
     * lost its schedule gets it back on its next trace. Rate-limited, so
     * the repeat costs at most one commit per project per claim window.
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
