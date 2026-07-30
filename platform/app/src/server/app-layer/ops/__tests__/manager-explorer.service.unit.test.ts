import type {
  BuiltPipeline,
  BuiltProcessManager,
  ProcessStore,
  Registry,
  StoredProcessState,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";

import { ManagerExplorerService } from "../manager-explorer.service";

function manager(overrides: Partial<BuiltProcessManager>): BuiltProcessManager {
  return {
    name: "triggerSettlement",
    enabled: true,
    eventTypes: ["trigger.matchRecorded"],
    intentTypes: ["persist", "notify"],
    stateSchema: {} as BuiltProcessManager["stateSchema"],
    stateVersion: "v1",
    schemaHash: "hash",
    intents: {},
    init: () => ({}),
    evolve: () => null,
    ...overrides,
  };
}

function registry(
  pipelines: Array<{
    aggregateType: string;
    processManagers: Record<string, BuiltProcessManager>;
  }>,
): Registry {
  return {
    all: () =>
      pipelines.map(({ aggregateType, processManagers }) => ({
        aggregateType,
        pipeline: {
          name: aggregateType,
          processManagers,
        } as unknown as BuiltPipeline,
      })),
  } as unknown as Registry;
}

function fakeStore(
  load?: () => Promise<StoredProcessState | null>,
): ProcessStore {
  return {
    load: vi.fn(load ?? (async () => null)),
    save: vi.fn(),
    due: vi.fn(async () => []),
  };
}

describe("ManagerExplorerService", () => {
  describe("given several pipelines are registered", () => {
    describe("when one aggregate type's managers are requested", () => {
      it("returns only the machines the owning pipeline declares", async () => {
        const service = new ManagerExplorerService(
          fakeStore(),
          registry([
            {
              aggregateType: "trigger",
              processManagers: { triggerSettlement: manager({}) },
            },
            {
              aggregateType: "langy_conversation",
              processManagers: {
                langyTurn: manager({ name: "langyTurn" }),
              },
            },
          ]),
        );

        const result = await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(result.map((m) => m.processName)).toEqual(["triggerSettlement"]);
      });
    });
  });

  describe("given no pipeline owns the aggregate type", () => {
    describe("when its managers are requested", () => {
      it("returns nothing rather than throwing", async () => {
        const service = new ManagerExplorerService(fakeStore(), registry([]));

        await expect(
          service.getForAggregate({
            aggregateType: "unregistered",
            projectId: "project-1",
            aggregateId: "x",
          }),
        ).resolves.toEqual([]);
      });
    });
  });

  describe("given a declared manager", () => {
    describe("when its instance is read", () => {
      it("keys the store by processName, projectId and aggregateId", async () => {
        const store = fakeStore();
        const service = new ManagerExplorerService(
          store,
          registry([
            {
              aggregateType: "trigger",
              processManagers: { triggerSettlement: manager({}) },
            },
          ]),
        );

        await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(store.load).toHaveBeenCalledWith({
          processName: "triggerSettlement",
          projectId: "project-1",
          processKey: "trigger-42",
        });
      });
    });
  });

  describe("given the machine has never started for this aggregate", () => {
    describe("when it is read", () => {
      it("reports a null instance rather than fabricating state", async () => {
        const service = new ManagerExplorerService(
          fakeStore(async () => null),
          registry([
            {
              aggregateType: "trigger",
              processManagers: { triggerSettlement: manager({}) },
            },
          ]),
        );

        const [found] = await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(found?.instance).toBeNull();
      });
    });
  });

  describe("given a running machine", () => {
    describe("when it is read", () => {
      it("surfaces its current position and whether it wakes", async () => {
        const service = new ManagerExplorerService(
          fakeStore(async () => ({
            state: { pendingMatches: {} },
            revision: 3,
            stateVersion: "v2",
            tenantId: "project-1",
          })),
          registry([
            {
              aggregateType: "trigger",
              processManagers: {
                triggerSettlement: manager({
                  onWake: () => ({ state: {}, intents: [], nextWakeAt: null }),
                }),
              },
            },
          ]),
        );

        const [found] = await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(found?.instance).toEqual({
          state: { pendingMatches: {} },
          revision: 3,
          stateVersion: "v2",
        });
        expect(found?.hasWake).toBe(true);
      });
    });
  });
});
