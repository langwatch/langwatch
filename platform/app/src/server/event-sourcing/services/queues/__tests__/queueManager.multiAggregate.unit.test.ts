/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature — a command on a
 * multi-aggregate pipeline carries its bound aggregate in every key (ADR-113).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlagServiceInterface } from "../../../../featureFlag/types";
import { declaredAggregateScope } from "../../../domain/aggregateScope";
import {
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import type { JobRegistryEntry } from "../queueManager";
import { QueueManager } from "../queueManager";
import {
  createMockCommandHandlerClass,
  createMockSharedQueue,
} from "./commandHandlerFixtures";

const scope = declaredAggregateScope({
  authz_grant: ["lw.authz.grant.attached"],
  authz_role: ["lw.authz.role.defined"],
});

describe("QueueManager on a multi-aggregate pipeline", () => {
  const tenantId = createTestTenantId("org_1");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("given a command bound to one of the pipeline's aggregates", () => {
    /** @scenario "A command's queue group key and kill-switch key use its bound aggregate" */
    it("keys the command's queue group by the bound aggregate type", () => {
      const globalJobRegistry = new Map<string, JobRegistryEntry>();
      const manager = new QueueManager({
        aggregateScope: scope,
        pipelineName: "authz_grant",
        globalQueue: createMockSharedQueue(),
        globalJobRegistry,
      });

      manager.initializeCommandQueues(
        [
          {
            name: "defineRole",
            handlerClass: createMockCommandHandlerClass("defineRole"),
            options: { aggregateType: "authz_role" },
          },
        ],
        vi.fn(),
        "authz_grant",
      );

      const entry = globalJobRegistry.get("authz_grant:command:defineRole");
      const groupKey = entry?.groupKeyFn({
        tenantId: String(tenantId),
        aggregateId: "r1",
        occurredAt: 1000,
      });

      expect(groupKey).toBe("org_1/command/defineRole/authz_role:r1");
    });

    /** @scenario "A command's queue group key and kill-switch key use its bound aggregate" */
    it("consults the kill switch keyed by the bound aggregate type", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);
      const featureFlagService = {
        isEnabled,
      } as unknown as FeatureFlagServiceInterface;
      const globalJobRegistry = new Map<string, JobRegistryEntry>();
      const manager = new QueueManager({
        aggregateScope: scope,
        pipelineName: "authz_grant",
        globalQueue: createMockSharedQueue(),
        globalJobRegistry,
        featureFlagService,
      });

      manager.initializeCommandQueues(
        [
          {
            name: "defineRole",
            handlerClass: createMockCommandHandlerClass("defineRole"),
            options: { aggregateType: "authz_role" },
          },
        ],
        vi.fn(),
        "authz_grant",
      );

      await globalJobRegistry.get("authz_grant:command:defineRole")?.process({
        tenantId: String(tenantId),
        aggregateId: "r1",
        occurredAt: 1000,
      });

      expect(isEnabled).toHaveBeenCalledWith(
        "es-authz_role-command-defineRole-killswitch",
        expect.objectContaining({ distinctId: String(tenantId) }),
      );
    });
  });

  describe("given a command that names no aggregate on the multi-aggregate pipeline", () => {
    /** @scenario "A command on a multi-aggregate pipeline must name its aggregate" */
    it("refuses to register it", () => {
      const manager = new QueueManager({
        aggregateScope: scope,
        pipelineName: "authz_grant",
        globalQueue: createMockSharedQueue(),
        globalJobRegistry: new Map(),
      });

      expect(() =>
        manager.initializeCommandQueues(
          [
            {
              name: "defineRole",
              handlerClass: createMockCommandHandlerClass("defineRole"),
            },
          ],
          vi.fn(),
          "authz_grant",
        ),
      ).toThrow(/"defineRole" must name the aggregate type/);
    });
  });

  describe("given a single-type pipeline", () => {
    /** @scenario "A single-aggregate pipeline is unchanged" */
    it("keys an unbound command by the pipeline's one type, as before", () => {
      const globalJobRegistry = new Map<string, JobRegistryEntry>();
      const manager = new QueueManager({
        aggregateScope: "trace",
        pipelineName: "trace_processing",
        globalQueue: createMockSharedQueue(),
        globalJobRegistry,
      });

      manager.initializeCommandQueues(
        [
          {
            name: "recordSpan",
            handlerClass: createMockCommandHandlerClass("recordSpan"),
          },
        ],
        vi.fn(),
        "trace_processing",
      );

      const groupKey = globalJobRegistry
        .get("trace_processing:command:recordSpan")
        ?.groupKeyFn({
          tenantId: String(tenantId),
          aggregateId: "t1",
          occurredAt: 1000,
        });

      expect(groupKey).toBe("org_1/command/recordSpan/trace:t1");
    });
  });
});
