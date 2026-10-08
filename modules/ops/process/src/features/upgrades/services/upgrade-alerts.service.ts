import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";

import type { UpgradeLedgerRepository } from "#repositories/upgrade-ledger.repository";
import type { PlatformOperatorsService } from "#services/platform-operators.service";

import { type UpgradeAlert, upgradeAlertsBetween } from "../rules/upgrade-alerts.rules.ts";

/** Ops' Slack notifier for upgrade alerts; a no-op where its bot token is not configured. */
export interface UpgradeAlertNotifier {
  notify(input: { alerts: readonly UpgradeAlert[]; upgradesUrl: string }): Promise<void>;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function describeUpgradeAlert(alert: UpgradeAlert): string {
  if (alert.kind === "step-failed") {
    return `Step ${alert.stepId} failed${alert.error ? `: ${alert.error}` : "."}`;
  }
  const holder = [alert.owner, alert.host].filter(Boolean).join(" on ");
  return `The upgrade runner${holder ? ` (${holder})` : ""} stopped holding its lease.`;
}

/**
 * Tells platform operators what went wrong with an upgrade since the last check: one email each
 * through notification's edge, and ops' Slack notifier where configured (ruling Q-U7).
 * Spec: modules/ops/specs/upgrade-alerts.feature
 */
export class UpgradeAlertsService {
  static create(input: {
    ledger: UpgradeLedgerRepository;
    operators: Pick<PlatformOperatorsService, "list">;
    mail: Pick<NotificationApi, "sendEmail">;
    notifier: UpgradeAlertNotifier;
    upgradesUrl: string;
  }): UpgradeAlertsService {
    return new UpgradeAlertsService(input);
  }

  private constructor(private readonly deps: Parameters<typeof UpgradeAlertsService.create>[0]) {}

  async check({ since, until }: { since: number; until: number }): Promise<UpgradeAlert[]> {
    const { ledger, operators, mail, notifier, upgradesUrl } = this.deps;
    // ponytail: first page of failed steps only; page through if a release ever fails more at once.
    const [status, failed] = await Promise.all([
      ledger.findStatus(),
      ledger.findSteps({ status: "failed" }),
    ]);
    const alerts = upgradeAlertsBetween({ status, failedSteps: failed.items, since, until });
    if (alerts.length === 0) return alerts;

    const subject =
      alerts.length === 1
        ? "LangWatch upgrade needs attention"
        : `LangWatch upgrade: ${alerts.length} problems`;
    const items = alerts.map((alert) => `<li>${escapeHtml(describeUpgradeAlert(alert))}</li>`);
    const html = `<p>An upgrade needs an operator.</p><ul>${items.join("")}</ul><p><a href="${escapeHtml(upgradesUrl)}">Open Upgrades</a></p>`;
    const recipients = (await operators.list()).flatMap(({ email }) => (email ? [email] : []));
    await Promise.all(
      recipients.map((to) =>
        mail.sendEmail({ to, subject, html, idempotencyKey: `upgrade-alert:${until}:${to}` }),
      ),
    );
    await notifier.notify({ alerts, upgradesUrl });
    return alerts;
  }
}
