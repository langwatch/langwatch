import {
  CHECK_DEFINITIONS,
  CHECKUP_DOCS,
  type CheckId,
  type CheckRow,
  type CheckupResult,
  type CheckVerdict,
  type ExplicitCheckInput,
  explicitCheckIds,
  freeCheckIds,
  getCheckDefinition,
} from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";

import type { CheckupFacts } from "../../../rules/checkup-facts.rules.ts";
import {
  NOT_ASKED_FOR,
  hostOf,
  reasonOf,
  withoutUserInfo,
} from "../../../rules/checkup-text.rules.ts";
import { CheckupMigrationsService } from "./checkup-migrations.service.ts";
import { CheckupPaidService } from "./checkup-paid.service.ts";

/**
 * The checkup of a self-hosted install (specs/self-hosting/checkup/checkup.feature).
 * A check that found the problem answers `refused` with a fix and a docs page;
 * one that could not run answers `unchecked` with the reason, never `verified`.
 */
export class CheckupService {
  private constructor(
    private readonly facts: CheckupFacts,
    private readonly migrations: CheckupMigrationsService,
    private readonly paidChecks: CheckupPaidService,
  ) {}

  static create(facts: CheckupFacts): CheckupService {
    return new CheckupService(
      facts,
      CheckupMigrationsService.create(facts),
      CheckupPaidService.create(facts),
    );
  }

  /** The free checks, which are what the page opens with. */
  async cheap(): Promise<CheckupResult> {
    const rows = await Promise.all(freeCheckIds().map((id) => this.row(id, () => this.free(id))));
    const explicit = explicitCheckIds().map((id) => ({
      ...getCheckDefinition(id),
      verdict: NOT_ASKED_FOR,
    }));
    return { ranAt: this.ranAt(), rows: inDefinitionOrder([...rows, ...explicit]) };
  }

  /** The checks that cost egress or money, run because someone asked. */
  async explicit(input: ExplicitCheckInput = {}): Promise<CheckupResult> {
    const wanted = new Set(input.checks ?? explicitCheckIds());
    const rows = await Promise.all(
      explicitCheckIds().map((id) =>
        wanted.has(id)
          ? this.row(id, () => this.paidChecks.run(id, input))
          : Promise.resolve({ ...getCheckDefinition(id), verdict: NOT_ASKED_FOR }),
      ),
    );
    return { ranAt: this.ranAt(), rows };
  }

  private ranAt(): string {
    return this.facts.now().toString({ fractionalSecondDigits: 3 });
  }

  /** A probe that threw before it could answer reads as not checked, naming the exception. */
  private async row(id: CheckId, run: () => Promise<CheckVerdict>): Promise<CheckRow> {
    try {
      return { ...getCheckDefinition(id), verdict: await run() };
    } catch (error) {
      return {
        ...getCheckDefinition(id),
        verdict: {
          outcome: "unchecked",
          detail: `The check itself failed before it could answer: ${reasonOf(error)}`,
        },
      };
    }
  }

  private async free(id: CheckId): Promise<CheckVerdict> {
    switch (id) {
      case "app":
        return this.app();
      case "postgres":
        return this.postgres();
      case "postgres_migrations":
        return this.postgresMigrations();
      case "clickhouse":
        return this.clickhouse();
      case "clickhouse_migrations":
        return this.clickhouseMigrations();
      case "lwql":
        return this.lwql();
      case "redis":
        return this.redis();
      case "gateway":
        return this.gateway();
      case "license":
        return this.license();
      case "connect":
        return this.connect();
      case "usage_report":
        return this.usageReport();
      case "storage":
        return this.storage();
      case "email":
        return this.email();
      case "model_providers":
        return this.modelProviders();
      default:
        return NOT_ASKED_FOR;
    }
  }

  private app(): CheckVerdict {
    const { version, processRole, environment } = this.facts.install;
    return {
      outcome: "verified",
      detail: `Release ${version}, running as the ${processRole} process, ${environment} environment.`,
    };
  }

  private async postgres(): Promise<CheckVerdict> {
    try {
      const serverVersion = await this.facts.postgres.ping();
      return { outcome: "verified", detail: `Postgres ${serverVersion} answers.` };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_postgres_unreachable",
        detail: `Postgres did not answer: ${reasonOf(error)}`,
        fix: "Check DATABASE_URL and that the database accepts connections from the app and worker pods.",
        docsPath: CHECKUP_DOCS.troubleshooting,
      };
    }
  }

  private postgresMigrations(): Promise<CheckVerdict> {
    return this.migrations.run({ kind: "postgres-schema", engine: "Postgres" });
  }

  private async clickhouse(): Promise<CheckVerdict> {
    if (!this.facts.clickhouse.configured) {
      return {
        outcome: "refused",
        code: "checkup_clickhouse_not_configured",
        detail: "CLICKHOUSE_URL is not set.",
        fix: "Set CLICKHOUSE_URL to the ClickHouse this install stores traces in and restart.",
        docsPath: CHECKUP_DOCS.environment,
      };
    }
    try {
      await this.facts.clickhouse.ping();
      return { outcome: "verified", detail: "ClickHouse answers a ping." };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_clickhouse_unreachable",
        detail: `ClickHouse did not answer: ${reasonOf(error)}`,
        fix: "Check CLICKHOUSE_URL, the credentials in it, and that the app can reach the host on that port.",
        docsPath: CHECKUP_DOCS.troubleshooting,
      };
    }
  }

  private async clickhouseMigrations(): Promise<CheckVerdict> {
    if (!this.facts.clickhouse.configured) {
      return { outcome: "unchecked", detail: "ClickHouse is not configured." };
    }
    return this.migrations.run({ kind: "clickhouse-schema", engine: "ClickHouse" });
  }

  private async lwql(): Promise<CheckVerdict> {
    if (!this.facts.clickhouse.configured) {
      return { outcome: "unchecked", detail: "ClickHouse is not configured." };
    }
    const [provisionable] = await this.facts.clickhouse.findAppFunctionsProvisionable();
    if (provisionable === undefined) {
      return {
        outcome: "unchecked",
        detail:
          "ClickHouse did not answer the two settings the provisioning probe reads (system.replicas and user_defined_zookeeper_path).",
        fix: "Give the app's ClickHouse user read access to system.replicas and system.server_settings.",
        docsPath: CHECKUP_DOCS.lwql,
      };
    }
    if (!provisionable) {
      return {
        outcome: "refused",
        code: "checkup_lwql_not_provisionable",
        detail:
          "ClickHouse is replicated and user_defined_zookeeper_path is not set, so LWQL app functions cannot be created on every replica.",
        fix: "Set user_defined_zookeeper_path in the ClickHouse server configuration on every replica and restart ClickHouse.",
        docsPath: CHECKUP_DOCS.lwql,
      };
    }
    return {
      outcome: "verified",
      detail: "LWQL app functions can be provisioned on this ClickHouse.",
    };
  }

  private async redis(): Promise<CheckVerdict> {
    const target = this.facts.redis.target;
    if (!target) {
      return {
        outcome: "refused",
        code: "checkup_redis_not_configured",
        detail: "REDIS_URL is not set.",
        fix: "Set REDIS_URL (or REDIS_CLUSTER_ENDPOINTS) and restart. Queues, rate limits and the Langy relay all need it.",
        docsPath: CHECKUP_DOCS.environment,
      };
    }
    const shown = withoutUserInfo(target);
    try {
      await this.facts.redis.ready();
      return { outcome: "verified", detail: `Redis answers at ${shown}.` };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_redis_unreachable",
        detail: `Redis did not answer at ${shown}: ${withoutUserInfo(reasonOf(error))}`,
        fix: "Check REDIS_URL and that the app can reach the host on that port.",
        docsPath: CHECKUP_DOCS.troubleshooting,
      };
    }
  }

  private async gateway(): Promise<CheckVerdict> {
    const gateway = await this.facts.gateway();
    const baseUrl = gateway.baseUrl;
    if (!baseUrl) {
      return {
        outcome: "unchecked",
        detail:
          "No AI Gateway is configured (LW_GATEWAY_BASE_URL is not set). Model traffic is observed, not routed.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    try {
      await gateway.health();
      return { outcome: "verified", detail: `The gateway at ${baseUrl} answers.` };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_gateway_unreachable",
        detail: `The gateway at ${baseUrl} did not answer: ${reasonOf(error)}`,
        fix: "Check that the gateway process is running and that LW_GATEWAY_BASE_URL names where the app can reach it.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
  }

  private async license(): Promise<CheckVerdict> {
    const license = await this.facts.license();
    if (!license.hasLicense) {
      return {
        outcome: "unchecked",
        detail: "No license is installed. The install runs on the open source baseline.",
        fix: "Enter an activation code on the License page to unlock seats and hosted services.",
        docsPath: CHECKUP_DOCS.licensing,
      };
    }
    if (license.corrupted) {
      return {
        outcome: "refused",
        code: "checkup_license_corrupted",
        detail: "The stored license cannot be read.",
        fix: "Replace it on the License page with the license you were issued.",
        docsPath: CHECKUP_DOCS.licensing,
      };
    }
    if (license.expired) {
      return {
        outcome: "refused",
        code: "checkup_license_expired",
        detail: `The license expired on ${licenseDay(license.expiresAt, "an unknown date")}.`,
        fix: "Renew it, then enter the new activation code on the License page.",
        docsPath: CHECKUP_DOCS.licensing,
      };
    }
    if (!license.valid) {
      return {
        outcome: "refused",
        code: "checkup_license_invalid",
        detail: "The license does not verify.",
        fix: "Enter the activation code or license key again, or contact support.",
        docsPath: CHECKUP_DOCS.licensing,
      };
    }
    const seats =
      license.maxMembers !== undefined
        ? `, ${license.currentMembers ?? 0} of ${license.maxMembers} seats used`
        : "";
    return {
      outcome: "verified",
      detail: `${license.planName ?? "Licensed"} until ${licenseDay(license.expiresAt, "no expiry")}${seats}.`,
    };
  }

  private async connect(): Promise<CheckVerdict> {
    const view = await this.facts.connect();
    if (view.deployment === "off") {
      return {
        outcome: "unchecked",
        detail:
          "Switched off by LANGWATCH_CONNECT_DISABLED. This install opens no connection to LangWatch, whatever its license says.",
        fix: "Unset LANGWATCH_CONNECT_DISABLED (Helm: app.connect.disabled) and restart to let the license decide.",
        docsPath: CHECKUP_DOCS.connect,
      };
    }
    if (!view.licensed || view.entitledServices.length === 0) {
      return {
        outcome: "unchecked",
        detail:
          "This install's license names no hosted service, so there is no sync to check. " +
          "A license with hosted services adds Instant Evals judging and managed models, " +
          "and delivers renewals and seat changes without a key to paste.",
        fix: "Enter an activation code on the License page. The license and its entitlements arrive over the connect host and refresh daily.",
        docsPath: CHECKUP_DOCS.connect,
      };
    }
    if (view.lastSyncError) {
      return {
        outcome: "refused",
        code: view.lastSyncError,
        detail: `The last license sync with ${view.licenseHost} was refused as ${view.lastSyncError}.`,
        fix: `Allow outbound HTTPS to ${view.licenseHost} and ${view.gatewayHost} on port 443, then wait for the next sync or restart.`,
        docsPath: CHECKUP_DOCS.connect,
      };
    }
    if (!view.lastSyncAt) {
      return {
        outcome: "unchecked",
        detail: `The license has not synced yet. The first sync runs two minutes after boot against ${view.licenseHost}.`,
        docsPath: CHECKUP_DOCS.connect,
      };
    }
    return {
      outcome: "verified",
      detail: `Last sync ${view.lastSyncAt} with ${view.licenseHost}. Services: ${view.entitledServices.join(", ")}.`,
    };
  }

  private async usageReport(): Promise<CheckVerdict> {
    const { usageReport } = this.facts;
    if (usageReport.disabled) {
      return {
        outcome: "unchecked",
        detail: "Switched off with DISABLE_USAGE_STATS. No usage report leaves this install.",
        docsPath: CHECKUP_DOCS.telemetry,
      };
    }
    const [[identity], endpoint] = await Promise.all([
      usageReport.findIdentity(),
      usageReport.getEndpoint(),
    ]);
    const host = hostOf(endpoint);
    if (identity?.lastReportError) {
      return {
        outcome: "refused",
        code: identity.lastReportError,
        detail: `The last report to ${host} did not land: ${identity.lastReportError}.`,
        fix: `Allow outbound HTTPS to ${host} on port 443. The report is retried every day at 12:00 UTC.`,
        docsPath: CHECKUP_DOCS.telemetry,
        meta: { host, port: 443 },
      };
    }
    if (!identity?.lastReportAt) {
      return {
        outcome: "unchecked",
        detail: `No report has been sent yet. The first one goes to ${host} at the next 12:00 UTC.`,
        docsPath: CHECKUP_DOCS.telemetry,
      };
    }
    return { outcome: "verified", detail: `Last report ${identity.lastReportAt} to ${host}.` };
  }

  private async storage(): Promise<CheckVerdict> {
    const [destination] = await this.facts.storage.findDestination();
    if (!destination) {
      return {
        outcome: "unchecked",
        detail: "No project exists yet, so there is no storage destination to resolve.",
      };
    }
    return { outcome: "verified", detail: `Stored objects go to ${destination}.` };
  }

  private async email(): Promise<CheckVerdict> {
    const { provider } = await this.facts.email();
    if (!provider) {
      return {
        outcome: "refused",
        code: "checkup_email_not_configured",
        detail: "No email provider is configured. Invitations and alerts cannot be sent.",
        fix: "Set EMAIL_PROVIDER to smtp, ses, sendgrid or resend with its credentials, and restart.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
    return { outcome: "verified", detail: `Email goes through ${provider}.` };
  }

  private async modelProviders(): Promise<CheckVerdict> {
    const providers = await this.facts.modelProviders();
    if (providers.length === 0) {
      return {
        outcome: "refused",
        code: "checkup_no_model_provider",
        detail: "No model provider is configured for this organization.",
        fix: "Add one under Settings, Model providers. Evaluations, Langy and the workbench all need one.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    const names = [...new Set(providers.map((row) => row.provider))].toSorted();
    return { outcome: "verified", detail: `Configured: ${names.join(", ")}.` };
  }
}

function inDefinitionOrder(rows: CheckRow[]): CheckRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return CHECK_DEFINITIONS.map((definition) => {
    const row = byId.get(definition.id);
    if (!row) throw new Error(`the checkup lost the ${definition.id} row`);
    return row;
  });
}

/** The day a license date falls on, as the License page shows it. */
function licenseDay(iso: string | undefined, whenAbsent: string): string {
  if (!iso) return whenAbsent;
  try {
    return Temporal.Instant.from(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}
