/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature — ops introspection of
 * a pipeline that owns several aggregate types (ADR-113). The registry reads
 * the live definitions, so the pipeline here is a real built definition.
 */
import { describe, expect, it, vi } from "vitest";

const definitions: unknown[] = [];
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ eventSourcing: { definitions } }),
  tryGetApp: () => ({ eventSourcing: { definitions } }),
}));

import { ManagerExplorerService } from "../../app-layer/ops/manager-explorer.service";
import type { Event } from "../domain/types";
import { definePipeline } from "../pipeline/staticBuilder";
import {
  getKillSwitchDescriptors,
  getProcessManagerMetadata,
  getProjectionMetadata,
} from "../pipelineRegistry";
import { createMockFoldProjectionDefinition } from "../services/__tests__/testHelpers";
import { createMockCommandHandlerClass } from "../services/queues/__tests__/commandHandlerFixtures";

function authzDefinition() {
  return definePipeline<Event>()
    .withName("authz_grant")
    .withAggregateTypes({
      authz_grant: ["lw.authz.grant.attached"],
      authz_role: ["lw.authz.role.defined"],
    })
    .withFoldProjection("ledger", createMockFoldProjectionDefinition("ledger"))
    .withCommand("defineRole", createMockCommandHandlerClass("defineRole"), {
      aggregateType: "authz_role",
    })
    .build();
}

describe("given a registered pipeline declaring two aggregate types", () => {
  /** @scenario "Ops introspection lists every aggregate type the pipeline owns" */
  it("lists both types on the projection, keeps the pause key per pipeline", () => {
    definitions.splice(0, definitions.length, authzDefinition());

    const ledger = getProjectionMetadata().find(
      (p) => p.projectionName === "ledger",
    );

    expect(ledger).toMatchObject({
      pipelineName: "authz_grant",
      aggregateTypes: ["authz_grant", "authz_role"],
      pauseKey: "authz_grant/projection/ledger",
    });
  });

  /** @scenario "Ops introspection lists every aggregate type the pipeline owns" */
  it("resolves the pipeline's managers from any of its aggregate types", async () => {
    definitions.splice(0, definitions.length, authzDefinition());
    const metadata = getProcessManagerMetadata;
    const service = new ManagerExplorerService({
      store: {
        findByRef: vi.fn().mockResolvedValue(null),
        findMessagesByRef: vi.fn().mockResolvedValue([]),
      } as never,
      fleet: {} as never,
      audit: {} as never,
      registry: () =>
        metadata().concat({
          processName: "roleSettlement",
          pipelineName: "authz_grant",
          aggregateType: "authz_grant",
          aggregateTypes: ["authz_grant", "authz_role"],
          eventTypes: [],
          intentTypes: [],
          scheduled: false,
          everyMs: null,
          hasWake: false,
        }),
    });

    const managers = await service.getForAggregate({
      aggregateType: "authz_role",
      projectId: "org_1",
      aggregateId: "r1",
    });

    expect(managers.map((m) => m.processName)).toEqual(["roleSettlement"]);
  });

  /** @scenario "A projection's kill-switch key on a multi-aggregate pipeline uses the pipeline name" */
  it("describes the projection kill switch by pipeline name and the command's by its bound type", () => {
    definitions.splice(0, definitions.length, authzDefinition());

    const keys = getKillSwitchDescriptors().map((d) => d.key);

    expect(keys).toContain("es-authz_grant-projection-ledger-killswitch");
    expect(keys).toContain("es-authz_role-command-defineRole-killswitch");
  });
});
