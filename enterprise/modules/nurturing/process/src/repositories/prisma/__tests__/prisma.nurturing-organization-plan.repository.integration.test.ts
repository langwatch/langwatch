// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's plan copy through the tenancy guards: the plan fold's store keeps the ids it folded
 * and the fact that won, as the memory twin does.
 * Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NurturingPlanFoldState } from "../../../rules/nurturing-organization-plan.rules.ts";
import { MemoryNurturingOrganizationPlanRepository } from "../../memory/memory.nurturing-organization-plan.repository.ts";
import type { NurturingOrganizationPlanRepository } from "../../nurturing-organization-plan.repository.ts";
import { PrismaNurturingOrganizationPlanRepository } from "../prisma.nurturing-organization-plan.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-plan-${randomUUID()}`;
const folded = `${namespace}-folded`;
const neverFolded = `${namespace}-never-folded`;

/** The fold's state after a fact at `occurredAt` won, by the event `winnerEventId`. */
const foldState = (
  plan: string,
  occurredAt: number,
  winnerEventId: string,
): NurturingPlanFoldState => ({
  held: { outcome: "held", fact: { plan, occurredAt, fromCatchUp: false } },
  winnerEventId,
  LastEventOccurredAt: occurredAt,
});

/** The store context the fold executor hands over for one organization's delivery. */
const foldContext = (appliedEventIds: readonly string[]): ProjectionStoreContext => ({
  aggregateId: folded,
  tenantId: createTenantId(folded),
  appliedEventIds,
});

describe.skipIf(!databaseUrl)("given nurturing's plan copy", () => {
  let connection: PrismaConnection;
  let plans: PrismaNurturingOrganizationPlanRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:plans"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    plans = PrismaNurturingOrganizationPlanRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingOrganizationPlan.deleteMany({
      where: { organizationId: folded },
    });
    await connection.closeOnce();
  });

  describe("when the plan fold stores an organization's state, then a losing fact's delivery", () => {
    /** @scenario "The plan fold's row keeps the ids it folded and the fact that won" */
    it("reads back the winning fact, its event and the latest delivery's ids, as the memory twin does", async () => {
      const twin = MemoryNurturingOrganizationPlanRepository.create();
      const steps = async (repository: NurturingOrganizationPlanRepository) => {
        await repository.store(foldState("LAUNCH", 2_000, "event-won"), foldContext(["event-won"]));
        // A later delivery of an older fact: the copy and its winner stay; the ids are its own.
        await repository.store(foldState("LAUNCH", 2_000, "event-won"), foldContext(["event-old"]));
      };
      await steps(plans);
      await steps(twin);

      const read = await plans.getWithApplied(folded);

      expect(read).toEqual(await twin.getWithApplied(folded));
      expect(read).toEqual({
        state: foldState("LAUNCH", 2_000, "event-won"),
        appliedEventIds: ["event-old"],
      });
    });
  });

  describe("when the plan fold reads an organization it never stored", () => {
    it("answers an absent row, so the fold starts from its initial state", async () => {
      await expect(plans.getWithApplied(neverFolded)).resolves.toEqual({
        state: null,
        appliedEventIds: [],
        miss: "absent",
      });
      await expect(plans.get(neverFolded)).resolves.toEqual({ kind: "empty" });
    });
  });
});
