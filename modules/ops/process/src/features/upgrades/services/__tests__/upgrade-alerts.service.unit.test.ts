import type { MailRender, UpgradeAlertEmailProps } from "@langwatch/mail";
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
import type { UpgradeDiagnosticsService } from "../upgrade-diagnostics.service.ts";

type Diagnostics = Pick<UpgradeDiagnosticsService, "getAvailability" | "send">;

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
  audience = "self-hosted",
  diagnostics,
}: {
  failedAt?: string | null;
  leaseExpiresAt?: string | null;
  audience?: UpgradeAlertEmailProps["audience"];
  diagnostics?: Diagnostics;
} = {}) {
  const failed = failedAt
    ? [
        stepOf({
          id: "ops:backfill",
          status: "failed",
          mode: "background",
          lastError: "boom",
          updatedAt: failedAt,
        }),
      ]
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
  const rendered: UpgradeAlertEmailProps[] = [];
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
    renderer: createApiFixture<Pick<MailRender, "renderUpgradeAlert">>({
      renderUpgradeAlert: async (input) => {
        rendered.push(input);
        return { subject: "subject", html: "html" };
      },
    }),
    upgradesUrl: "https://app.example.com/ops/upgrades",
    audience,
    diagnostics,
  });
  return { service, sent, rendered };
}

describe("UpgradeAlertsService", () => {
  /** @scenario "A step that failed since the last wake is alerted" */
  it("alerts a step that failed inside the window", async () => {
    const { service } = setup({ failedAt: ago(10) });
    expect(await service.check({ since: SINCE, until: UNTIL })).toEqual([
      {
        kind: "step-failed",
        stepId: "ops:backfill",
        error: "boom",
        description: null,
        release: "3.21.0",
        mode: "background",
        attempt: 1,
      },
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

  /** @scenario "The alert email links each failed step to its own page" */
  it("renders each failed step with a direct link and names the installation", async () => {
    const { service, rendered } = setup({ failedAt: ago(10), leaseExpiresAt: ago(5) });
    await service.check({ since: SINCE, until: UNTIL });
    expect(rendered).toEqual([
      {
        installation: "app.example.com",
        upgradesUrl: "https://app.example.com/ops/upgrades",
        audience: "self-hosted",
        failedSteps: [
          {
            id: "ops:backfill",
            description: null,
            release: "3.21.0",
            mode: "background",
            attempt: 1,
            error: "boom",
            url: "https://app.example.com/ops/upgrades?upgradeStep=ops%3Abackfill",
          },
        ],
        runnerStopped: { owner: "pod-a", host: "h" },
        diagnostics: "download",
      },
    ]);
  });

  describe("when the installation is LangWatch Cloud", () => {
    /** @scenario "On LangWatch Cloud the alert email is worded for LangWatch staff" */
    it("renders the email for LangWatch staff", async () => {
      const cloud = setup({ failedAt: ago(10), audience: "langwatch-cloud" });
      await cloud.service.check({ since: SINCE, until: UNTIL });
      expect(cloud.rendered.map(({ audience }) => audience)).toEqual(["langwatch-cloud"]);
    });
  });

  describe("when the installation is self-hosted", () => {
    /** @scenario "On a self-hosted installation the alert email is worded for its operator" */
    it("renders the email for the installation's operator", async () => {
      const selfHosted = setup({ failedAt: ago(10) });
      await selfHosted.service.check({ since: SINCE, until: UNTIL });
      expect(selfHosted.rendered.map(({ audience }) => audience)).toEqual(["self-hosted"]);
    });
  });
  describe("when the installation can send diagnostics", () => {
    function diagnosticsOf({
      available = true,
      automatic = false,
      sendFails = false,
    }: { available?: boolean; automatic?: boolean; sendFails?: boolean } = {}) {
      const sends: { id: string; trigger: string }[] = [];
      const diagnostics = createApiFixture<Diagnostics>({
        getAvailability: async () => ({
          available,
          reason: available ? null : "connect_disabled",
          automatic,
        }),
        send: async ({ id, trigger }) => {
          sends.push({ id, trigger });
          if (sendFails) throw new Error("connect is down");
          return { reportId: "r-1", receivedAt: NOW.toString() };
        },
      });
      return { diagnostics, sends };
    }

    describe("given sending is automatic", () => {
      /** @scenario "A newly failed step's diagnostics are sent automatically and the email says so" */
      it("sends the failed step once, automatically, and the email says sent", async () => {
        const { diagnostics, sends } = diagnosticsOf({ automatic: true });
        const { service, rendered } = setup({ failedAt: ago(10), diagnostics });
        await service.check({ since: SINCE, until: UNTIL });
        expect(sends).toEqual([{ id: "ops:backfill", trigger: "automatic" }]);
        expect(rendered.map(({ diagnostics: each }) => each)).toEqual(["sent"]);
      });

      /** @scenario "A diagnostics send that fails still sends the email, which asks the operator to send" */
      it("still sends the email, asking the operator to send, when the send throws", async () => {
        const { diagnostics } = diagnosticsOf({ automatic: true, sendFails: true });
        const { service, rendered, sent } = setup({ failedAt: ago(10), diagnostics });
        await service.check({ since: SINCE, until: UNTIL });
        expect(rendered.map(({ diagnostics: each }) => each)).toEqual(["send"]);
        expect(sent).toHaveLength(1);
      });
    });

    describe("given sending is available but not automatic", () => {
      /** @scenario "Without automatic sending nothing is sent and the email offers to send" */
      it("sends nothing and the email says send", async () => {
        const { diagnostics, sends } = diagnosticsOf({ automatic: false });
        const { service, rendered } = setup({ failedAt: ago(10), diagnostics });
        await service.check({ since: SINCE, until: UNTIL });
        expect(sends).toEqual([]);
        expect(rendered.map(({ diagnostics: each }) => each)).toEqual(["send"]);
      });
    });

    describe("given sending is unavailable", () => {
      /** @scenario "Without a way to send, the email offers to download the diagnostics" */
      it("sends nothing and the email says download", async () => {
        const { diagnostics, sends } = diagnosticsOf({ available: false });
        const { service, rendered } = setup({ failedAt: ago(10), diagnostics });
        await service.check({ since: SINCE, until: UNTIL });
        expect(sends).toEqual([]);
        expect(rendered.map(({ diagnostics: each }) => each)).toEqual(["download"]);
      });
    });

    describe("given no diagnostics dependency", () => {
      it("says download", async () => {
        const { service, rendered } = setup({ failedAt: ago(10) });
        await service.check({ since: SINCE, until: UNTIL });
        expect(rendered.map(({ diagnostics: each }) => each)).toEqual(["download"]);
      });
    });
  });
});
