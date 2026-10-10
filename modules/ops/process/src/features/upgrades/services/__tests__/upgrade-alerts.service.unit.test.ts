import type {
  NotificationService as NotificationApi,
  SendEmailCommand,
} from "@langwatch/notification-contract";
import type { OpsPlatformOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { UpgradeReader } from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import { MemoryUpgradeLedgerRepository } from "#repositories/memory/memory.upgrade-ledger.repository";
import type { PlatformOperatorsService } from "#services/platform-operators.service";

import { statusOf, stepOf } from "../../../../services/__tests__/support/upgrade-ledger.ts";
import { UpgradeAlertsService } from "../upgrade-alerts.service.ts";

const NOW = Temporal.Instant.from("2026-10-09T12:00:00Z");
const SINCE = NOW.subtract({ hours: 1 }).epochMilliseconds;
const UNTIL = NOW.epochMilliseconds;
const ago = (minutes: number) => NOW.subtract({ minutes }).toString();

function operator(email: string | null): OpsPlatformOperator {
  return { grantId: `g-${email}`, userId: `u-${email}`, name: null, email, grantedAt: NOW };
}

function setup({
  failedAt = null,
  leaseExpiresAt = null,
}: { failedAt?: string | null; leaseExpiresAt?: string | null } = {}) {
  const failed = failedAt
    ? [stepOf({ id: "ops:backfill", status: "failed", lastError: "boom", updatedAt: failedAt })]
    : [];
  const status = statusOf({
    lease: leaseExpiresAt
      ? {
          name: "upgrade",
          owner: "pod-a",
          image: "3.23.0",
          host: "h",
          heartbeatAt: null,
          expiresAt: leaseExpiresAt,
        }
      : null,
  });
  const sent: SendEmailCommand[] = [];
  const service = UpgradeAlertsService.create({
    ledger: MemoryUpgradeLedgerRepository.create({
      reader: createApiFixture<UpgradeReader>({
        status: async () => status,
        listSteps: async () => ({ items: failed, cursor: null }),
      }),
    }),
    operators: createApiFixture<Pick<PlatformOperatorsService, "list">>({
      list: async () => [operator("ops@example.com"), operator(null)],
    }),
    mail: createApiFixture<Pick<NotificationApi, "sendEmail">>({
      sendEmail: async (command) => void sent.push(command),
    }),
    upgradesUrl: "https://app.example.com/ops/upgrades",
  });
  return { service, sent };
}

describe("UpgradeAlertsService", () => {
  /** @scenario "A step that failed since the last wake is alerted" */
  it("alerts a step that failed inside the window", async () => {
    const { service } = setup({ failedAt: ago(10) });
    expect(await service.check({ since: SINCE, until: UNTIL })).toEqual([
      { kind: "step-failed", stepId: "ops:backfill", error: "boom" },
    ]);
  });

  /** @scenario "A step that failed before the last wake is not alerted again" */
  it("ignores a step that failed before the window", async () => {
    const { service } = setup({ failedAt: ago(120) });
    expect(await service.check({ since: SINCE, until: UNTIL })).toEqual([]);
  });

  /** @scenario "A lease that expired since the last wake is alerted as a runner that died" */
  it("alerts a lease that expired inside the window", async () => {
    const { service } = setup({ leaseExpiresAt: ago(5) });
    expect(await service.check({ since: SINCE, until: UNTIL })).toEqual([
      { kind: "lease-expired", owner: "pod-a", host: "h" },
    ]);
  });

  /** @scenario "A lease a live runner still holds is not alerted" */
  it("ignores a lease that has not expired yet", async () => {
    const { service } = setup({ leaseExpiresAt: NOW.add({ minutes: 5 }).toString() });
    expect(await service.check({ since: SINCE, until: UNTIL })).toEqual([]);
  });

  /** @scenario "Each platform operator with an email address gets the alert once per wake" */
  it("emails each operator with an address, keyed by wake and recipient", async () => {
    const { service, sent } = setup({ failedAt: ago(10) });
    await service.check({ since: SINCE, until: UNTIL });
    expect(sent.map(({ to, idempotencyKey }) => ({ to, idempotencyKey }))).toEqual([
      { to: "ops@example.com", idempotencyKey: `upgrade-alert:${UNTIL}:ops@example.com` },
    ]);
  });

  /** @scenario "Nothing is sent when nothing changed" */
  it("sends nothing when nothing changed", async () => {
    const { service, sent } = setup();
    await service.check({ since: SINCE, until: UNTIL });
    expect(sent).toEqual([]);
  });
});
