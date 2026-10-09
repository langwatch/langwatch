/**
 * Pinning writes under the project it names but is declared under `project:update`, a resource
 * the permission-level guard exempts so an admin can still manage an aggregate; so pin and unpin
 * ask the project themselves before writing (ADR-175 decision 8).
 */
import type { PinnedTrace, PinTraceInput } from "@langwatch/data-retention-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { AggregateProjectIsReadOnlyError, type ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import { describe, expect, it, vi } from "vitest";

import { shareProcessModule } from "../../share.module.ts";
import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
} from "./share.fixture.ts";

const PIN = { projectId: "project-1", traceId: "trace-1" };

async function bootWith({ aggregate }: { aggregate: boolean }) {
  const written = {
    pin: vi.fn(async (input: PinTraceInput): Promise<PinnedTrace> => ({
      id: "pin_1",
      projectId: input.projectId,
      traceId: input.traceId,
      userId: null,
      source: "share",
      reason: null,
      createdAt: new Date(0),
    })),
    unpin: vi.fn(async () => void 0),
  };
  const retention = Object.assign(createShareTestDataRetention(), written);
  const projects: ProjectApi = aggregate
    ? createShareTestProjects({
        assertAcceptsWrites: async () => {
          throw new AggregateProjectIsReadOnlyError();
        },
      })
    : createShareTestProjects();
  const runtime = await createApp({ role: "api" })
    .withModules([shareProcessModule])
    .withStores(memoryStores())
    .provide({ authz: createShareTestAuthz(), "data-retention": retention, project: projects })
    .boot();

  return { runtime, written, app: runtime.service(ShareApi) };
}

const writes: [string, (app: ShareApi) => Promise<unknown>, "pin" | "unpin"][] = [
  ["pinTrace", (app) => app.pinTrace({ ...PIN, userId: "user-1" }), "pin"],
  ["unpinTrace", (app) => app.unpinTrace(PIN), "unpin"],
];

describe("ShareModule trace pins", () => {
  describe.each(writes)("when %s is called", (_name, act, write) => {
    describe("given an aggregate project", () => {
      it("refuses as read-only and writes no pin", async () => {
        const { runtime, written, app } = await bootWith({ aggregate: true });

        try {
          await expect(act(app)).rejects.toMatchObject({ code: "aggregate_project_is_read_only" });
          expect(written[write]).not.toHaveBeenCalled();
        } finally {
          await runtime.stop();
        }
      });
    });

    describe("given an ordinary project", () => {
      it("writes the pin", async () => {
        const { runtime, written, app } = await bootWith({ aggregate: false });

        try {
          await act(app);
          expect(written[write]).toHaveBeenCalledTimes(1);
        } finally {
          await runtime.stop();
        }
      });
    });
  });
});
