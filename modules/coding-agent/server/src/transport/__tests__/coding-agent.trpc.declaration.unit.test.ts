/**
 * @vitest-environment node
 * The `codingAgents.*` wire, pinned: every procedure name, its kind and the
 * permission bound to it. A rename is a cache-key change in every browser.
 */
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import { codingAgentTrpc } from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import { codingAgentTrpcTransport } from "../coding-agent.trpc.ts";

/** Mounts the declaration and records what each procedure asked for. */
function boundProcedures(): { procedure: string; permission: unknown }[] {
  const bound: { procedure: string; permission: unknown }[] = [];

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      bound.push({
        procedure,
        permission: access.kind === "permission" ? access.permission : access,
      });

      return {};
    },
    router: (record) => record,
  };

  const mount = codingAgentTrpcTransport.router as TrpcRouterMount<never, never>;

  (mount as unknown as (factory: TrpcProcedureFactory<object>, app: unknown) => void)(
    runtime,
    () => {
      throw new Error("the wire table never resolves an application");
    },
  );

  return bound;
}

describe("the codingAgents tRPC surface", () => {
  describe("given the contract the browser reads", () => {
    it("keeps the namespace the React Query cache key is hashed from", () => {
      expect(codingAgentTrpc.namespace).toBe("codingAgents");
    });

    it("declares every procedure as a read, under the name it has always had", () => {
      expect(
        Object.entries(codingAgentTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["usageTotals", "query"],
        ["recentSessions", "query"],
        ["sessionsList", "query"],
        ["pullRequestUsage", "query"],
        ["pullRequestDetail", "query"],
      ]);
    });

    it("answers every one of them with a declared output", () => {
      for (const [name, member] of Object.entries(codingAgentTrpc.members)) {
        expect([name, member.output !== undefined]).toEqual([name, true]);
      }
    });
  });

  describe("given the binding a process mounts", () => {
    it("asks traces:view of every procedure, the cut tracesV2 asks", () => {
      expect(boundProcedures()).toEqual([
        { procedure: "codingAgents.usageTotals", permission: "traces:view" },
        { procedure: "codingAgents.recentSessions", permission: "traces:view" },
        { procedure: "codingAgents.sessionsList", permission: "traces:view" },
        { procedure: "codingAgents.pullRequestUsage", permission: "traces:view" },
        { procedure: "codingAgents.pullRequestDetail", permission: "traces:view" },
      ]);
    });
  });
});
