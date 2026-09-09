/**
 * @vitest-environment node
 * The `home.*` surface: the recent-items strip, the person it is read for, and
 * the default row count. The user id is the runtime's resolved actor and never
 * anything the caller sent, which would widen the read to another trail.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { RecentItem } from "@langwatch/project-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { homeTrpcTransport } from "../home.trpc.ts";
import { projectTrpcTestPorts, type ProjectTrpcTestContext } from "./project.trpc.harness.ts";

const READER_ID = "reader-1";

function recentItem(overrides: Partial<RecentItem> = {}): RecentItem {
  return {
    id: "prompt_1",
    type: "prompt",
    name: "A prompt",
    href: "/p/prompts/prompt_1",
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mount({ rows = [recentItem()] }: { rows?: RecentItem[] } = {}) {
  const reader =
    vi.fn<(input: { userId: string; projectId: string; limit: number }) => Promise<RecentItem[]>>(
      async () => rows,
    );
  const trpc = initTRPC.context<ProjectTrpcTestContext>().create();
  const router = createTrpcRuntime<ProjectTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: projectTrpcTestPorts(),
  }).mount(homeTrpcTransport, () => ({ getRecentItems: reader }));

  return { reader, caller: router.createCaller({ actor: { id: READER_ID } }) };
}

describe("the home tRPC namespace", () => {
  describe("given a signed-in reader", () => {
    it("reads the strip for the resolved actor and answers the reader's rows", async () => {
      const rows = [recentItem(), recentItem({ id: "dataset_1", type: "dataset" })];
      const { caller, reader } = mount({ rows });

      await expect(caller.getRecentItems({ projectId: "project-1", limit: 5 })).resolves.toEqual(
        rows,
      );
      expect(reader).toHaveBeenCalledWith({
        userId: READER_ID,
        projectId: "project-1",
        limit: 5,
      });
    });

    it("renders twelve rows when the caller asks for no count", async () => {
      const { caller, reader } = mount();

      await caller.getRecentItems({ projectId: "project-1" });

      expect(reader).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 }));
    });
  });

  describe("when the caller asks for more rows than the strip renders", () => {
    it("refuses on the parser and never reaches the trail", async () => {
      const { caller, reader } = mount();

      await expect(
        caller.getRecentItems({ projectId: "project-1", limit: 500 }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(reader).not.toHaveBeenCalled();
    });
  });
});
