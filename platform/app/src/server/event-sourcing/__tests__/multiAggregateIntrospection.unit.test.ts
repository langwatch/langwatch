/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature and
 * specs/ops/internal-feature-flags.feature — ops introspection of a pipeline
 * that owns several aggregate types (ADR-113). The registry reads the live
 * definitions, so the pipeline here is a real built definition.
 */
import { describe, expect, it, vi } from "vitest";

const definitions: unknown[] = [];
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ eventSourcing: { definitions } }),
  tryGetApp: () => ({ eventSourcing: { definitions } }),
}));

import { ManagerExplorerService } from "../../app-layer/ops/manager-explorer.service";
import type { Event } from "../domain/types";
import { defineProcessManager } from "../pipeline/processManagerDefinition";
import { definePipeline } from "../pipeline/staticBuilder";
import {
  getKillSwitchDescriptors,
  getProcessManagerMetadata,
  getProjectionMetadata,
} from "../pipelineRegistry";
import { createMockFoldProjectionDefinition } from "../services/__tests__/testHelpers";
import { createMockCommandHandlerClass } from "../services/queues/__tests__/commandHandlerFixtures";

type ExplorerDeps = ConstructorParameters<typeof ManagerExplorerService>[0];

function authzDefinition() {
  return definePipeline<Event>()
    .withName("authz")
    .withAggregateTypes({
      authz_grant: ["lw.authz.grant.attached"],
      authz_role: ["lw.authz.role.defined"],
    })
    .withFoldProjection("ledger", createMockFoldProjectionDefinition("ledger"))
    .withCommand("defineRole", createMockCommandHandlerClass("defineRole"), {
      aggregateType: "authz_role",
    })
    .withProcessManager(
      defineProcessManager({
        name: "roleSettlement",
        state: {},
        handlers: {},
        eventTypes: ["lw.authz.role.defined"],
        intents: {},
      }),
    )
    .build();
}

function managerExplorer() {
  return new ManagerExplorerService({
    store: {
      findByRef: vi.fn().mockResolvedValue(null),
      findMessagesByRef: vi.fn().mockResolvedValue([]),
    } as unknown as ExplorerDeps["store"],
    fleet: {} as ExplorerDeps["fleet"],
    audit: {} as ExplorerDeps["audit"],
    registry: getProcessManagerMetadata,
  });
}

describe("given a registered pipeline declaring two aggregate types", () => {
  /** @scenario "Ops introspection lists every aggregate type the pipeline owns" */
  it("lists both types on the projection, keeps the pause key per pipeline", () => {
    definitions.splice(0, definitions.length, authzDefinition());

    const ledger = getProjectionMetadata().find(
      (p) => p.projectionName === "ledger",
    );

    expect(ledger).toMatchObject({
      pipelineName: "authz",
      aggregateTypes: ["authz_grant", "authz_role"],
      pauseKey: "authz/projection/ledger",
    });
  });

  /** @scenario "Ops introspection lists every aggregate type the pipeline owns" */
  it("resolves the pipeline's process managers from any of its aggregate types", async () => {
    definitions.splice(0, definitions.length, authzDefinition());

    expect(getProcessManagerMetadata()).toEqual([
      expect.objectContaining({
        processName: "roleSettlement",
        pipelineName: "authz",
        aggregateTypes: ["authz_grant", "authz_role"],
      }),
    ]);
    const byRole = await managerExplorer().getForAggregate({
      aggregateType: "authz_role",
      projectId: "org_1",
      aggregateId: "r1",
    });
    const byGrant = await managerExplorer().getForAggregate({
      aggregateType: "authz_grant",
      projectId: "org_1",
      aggregateId: "g1",
    });

    expect(byRole.map((m) => m.processName)).toEqual(["roleSettlement"]);
    expect(byGrant.map((m) => m.processName)).toEqual(["roleSettlement"]);
  });

  describe("when the kill-switch descriptors are generated", () => {
    /** @scenario "kill switch key for a projection on a multi-aggregate pipeline uses the pipeline name" */
    it("describes the projection kill switch by pipeline name", () => {
      definitions.splice(0, definitions.length, authzDefinition());

      const keys = getKillSwitchDescriptors().map((d) => d.key);

      expect(keys).toContain("es-authz-projection-ledger-killswitch");
    });

    /** @scenario "A projection's kill-switch key on a multi-aggregate pipeline uses the pipeline name" */
    it("never spells the projection kill switch with a declared type", () => {
      definitions.splice(0, definitions.length, authzDefinition());

      const keys = getKillSwitchDescriptors().map((d) => d.key);

      expect(keys).not.toContain(
        "es-authz_grant-projection-ledger-killswitch",
      );
      expect(keys).not.toContain("es-authz_role-projection-ledger-killswitch");
    });

    /** @scenario "kill switch key for a command on a multi-aggregate pipeline uses the command's bound aggregate" */
    it("describes the command kill switch by its bound aggregate type", () => {
      definitions.splice(0, definitions.length, authzDefinition());

      const keys = getKillSwitchDescriptors().map((d) => d.key);

      expect(keys).toContain("es-authz_role-command-defineRole-killswitch");
    });
  });
});
