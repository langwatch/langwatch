import type { MailRender, UpgradeAlertEmailProps } from "@langwatch/mail";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";

import type { UpgradeLedgerRepository } from "#repositories/upgrade-ledger.repository";
import type { PlatformOperatorsService } from "#services/platform-operators.service";

import { type UpgradeAlert, upgradeAlertsBetween } from "../rules/upgrade-alerts.rules.ts";

/** The host an operator knows this install by; the bare phrase when no public URL is set. */
function installationOf(upgradesUrl: string): string {
  return URL.canParse(upgradesUrl) ? new URL(upgradesUrl).host : "this installation";
}

function toUpgradeAlertMail({
  alerts,
  upgradesUrl,
  audience,
}: {
  alerts: UpgradeAlert[];
  upgradesUrl: string;
  audience: UpgradeAlertEmailProps["audience"];
}): UpgradeAlertEmailProps {
  const failedSteps = alerts.flatMap((alert) =>
    alert.kind === "step-failed"
      ? [
          {
            id: alert.stepId,
            description: alert.description,
            release: alert.release,
            mode: alert.mode,
            attempt: alert.attempt,
            error: alert.error,
            url: `${upgradesUrl}?upgradeStep=${encodeURIComponent(alert.stepId)}`,
          },
        ]
      : [],
  );
  const runner = alerts.find((alert) => alert.kind === "lease-expired");
  return {
    installation: installationOf(upgradesUrl),
    upgradesUrl,
    audience,
    failedSteps,
    runnerStopped: runner ? { owner: runner.owner, host: runner.host } : null,
  };
}

/**
 * Tells this installation's platform operators what went wrong with an upgrade since the last
 * check: one email each through notification's edge. Never LangWatch's Slack (Alex, 2026-10-09).
 * Spec: modules/ops/specs/upgrade-alerts.feature
 */
export class UpgradeAlertsService {
  static create(input: {
    ledger: UpgradeLedgerRepository;
    operators: Pick<PlatformOperatorsService, "list">;
    mail: Pick<NotificationApi, "sendEmail">;
    renderer: Pick<MailRender, "renderUpgradeAlert">;
    upgradesUrl: string;
    /** LangWatch staff read ids and errors on Cloud; a self-hosted operator reads plain words. */
    audience: UpgradeAlertEmailProps["audience"];
  }): UpgradeAlertsService {
    return new UpgradeAlertsService(input);
  }

  private constructor(private readonly deps: Parameters<typeof UpgradeAlertsService.create>[0]) {}

  async check({ since, until }: { since: number; until: number }): Promise<UpgradeAlert[]> {
    const { ledger, operators, mail, renderer, upgradesUrl, audience } = this.deps;
    // ponytail: first page of failed steps only; page through if a release ever fails more at once.
    const [status, failed] = await Promise.all([
      ledger.findStatus(),
      ledger.findSteps({ status: "failed" }),
    ]);
    const alerts = upgradeAlertsBetween({ status, failedSteps: failed.items, since, until });
    if (alerts.length === 0) return alerts;

    const { subject, html } = await renderer.renderUpgradeAlert(
      toUpgradeAlertMail({ alerts, upgradesUrl, audience }),
    );
    const recipients = (await operators.list()).flatMap(({ email }) => (email ? [email] : []));
    await Promise.all(
      recipients.map((to) =>
        mail.sendEmail({ to, subject, html, idempotencyKey: `upgrade-alert:${until}:${to}` }),
      ),
    );
    return alerts;
  }
}
