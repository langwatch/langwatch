/**
 * The process policy wrapped around the package-owned topic transport: the
 * surface stays authenticated, each procedure keeps the permission it asked
 * for before the move, and the procedure names remain the compatibility
 * contract the browser calls.
 *
 * @vitest-environment node
 */
import { authzDeclarationOf } from "@langwatch/authz-contract";
import type {
  Topic,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicService,
} from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { topicsRouter } from "../topic.router";

const PROJECT_ID = "project_1";

const TOPIC: Topic = {
  id: "topic_1",
  name: "Billing questions",
  parentId: null,
  automaticallyGenerated: true,
};

const STATUS: TopicClusteringStatus = {
  lastRequestedAt: null,
  lastRequestTrigger: null,
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunMode: null,
  lastRunSkippedReason: null,
  lastRunErrorCode: null,
  isLastRunErrorUserActionable: false,
  lastRunTracesProcessed: 0,
  lastRunTopicsCount: 0,
  lastRunSubtopicsCount: 0,
  isInProgress: false,
  isRunInFlight: false,
  nextRunAt: null,
};

const HISTORY: TopicClusteringRunHistoryEntry[] = [];

/** A topic service that answers without persistence, and records what it was asked. */
class RecordingTopicService implements TopicService {
  readonly seenProjectIds: string[] = [];

  async getAll(input: { projectId: string }): Promise<Topic[]> {
    this.seenProjectIds.push(input.projectId);
    return [TOPIC];
  }

  async getNamesByIds(): Promise<Map<string, string>> {
    return new Map();
  }

  async getClusteringStatus(): Promise<TopicClusteringStatus> {
    return STATUS;
  }

  async getClusteringRunHistory(): Promise<TopicClusteringRunHistoryEntry[]> {
    return HISTORY;
  }
}

function buildContext(
  session: { user: { id: string }; expires: string } | null,
  topics: TopicService,
) {
  const app = { topics } as unknown as RequestAppServices;

  return createInnerTRPCContext({
    app,
    session,
    // The declared check is what decides access; the mount's policy chain runs
    // it, so the context starts unchecked exactly as a real request does.
    permissionChecked: false,
    publiclyShared: false,
  });
}

describe("topic transport mount", () => {
  describe("given the composed router", () => {
    it("keeps the legacy procedure names the browser calls", () => {
      const procedures = (
        topicsRouter as unknown as { _def: { procedures: Record<string, unknown> } }
      )._def.procedures;

      expect(Object.keys(procedures).sort()).toEqual([
        "getAll",
        "getClusteringRunHistory",
        "getClusteringStatus",
      ]);
    });

    it("keeps the permission each procedure asked for before the move", () => {
      const procedures = (
        topicsRouter as unknown as {
          _def: { procedures: Record<string, { _def: { middlewares?: unknown[] } }> };
        }
      )._def.procedures;

      const permissionsOf = (name: string) =>
        (procedures[name]?._def.middlewares ?? [])
          .map((middleware) => authzDeclarationOf(middleware))
          .filter((declaration) => declaration !== null)
          .flatMap((declaration) =>
            declaration.kind === "permission" ? [declaration.permission] : [],
          );

      expect(permissionsOf("getAll")).toEqual(["traces:view"]);
      expect(permissionsOf("getClusteringStatus")).toEqual(["project:view"]);
      expect(permissionsOf("getClusteringRunHistory")).toEqual(["project:view"]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the feature service runs", async () => {
      const topics = new RecordingTopicService();
      const caller = topicsRouter.createCaller(buildContext(null, topics));

      await expect(caller.getAll({ projectId: PROJECT_ID })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(topics.seenProjectIds).toEqual([]);
    });
  });
});
