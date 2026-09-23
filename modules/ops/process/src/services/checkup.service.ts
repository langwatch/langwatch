import type { InstanceIdentityView } from "@langwatch/enterprise-licensing-contract";
import { HandledError } from "@langwatch/handled-error";
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
import { type Instant, Temporal } from "@langwatch/time";

/** What a control plane probe of the local gateway came back with. */
export type ControlPlaneProbe =
  | { readonly kind: "ok"; readonly controlPlaneBaseUrl: string }
  | { readonly kind: "unreachable"; readonly reason: string };

/** What a model provider connection test came back with. */
export type ProviderTestOutcome =
  | { readonly outcome: "verified" }
  | { readonly outcome: "refused"; readonly code: string; readonly message: string }
  | { readonly outcome: "unchecked"; readonly reason: string };

/** What a canary route answered. */
export interface CanaryAnswer {
  readonly status: number;
  readonly body: unknown;
}

export type CanaryName = "collector" | "processor" | "evaluations" | "scenarios" | "langy";

/** Where the daily license sync stands, as the connect settings report it. */
export interface CheckupConnectView {
  readonly deployment: "off" | "on";
  readonly licensed: boolean;
  readonly entitledServices: string[];
  readonly lastSyncAt?: string;
  readonly lastSyncError?: string;
  readonly licenseHost: string;
  readonly gatewayHost: string;
}

export interface CheckupLicenseView {
  readonly hasLicense: boolean;
  readonly valid: boolean;
  readonly expired?: boolean;
  readonly corrupted?: boolean;
  readonly planName?: string;
  readonly expiresAt?: string;
  readonly currentMembers?: number;
  readonly maxMembers?: number;
}

export interface CheckupGatewayFacts {
  readonly baseUrl: string | undefined;
  readonly expectedControlPlaneUrl: string | undefined;
  readonly health: () => Promise<void>;
  readonly probeControlPlane: () => Promise<ControlPlaneProbe>;
}

export interface CheckupEmailFacts {
  readonly provider: string | undefined;
  readonly smtpConfigured: boolean;
  readonly verifySmtp: () => Promise<void>;
}

/**
 * Everything a check reads, one fact or one probe each, so a suite states the
 * world in a few lines. Every probe resolves or throws; the check decides what
 * a throw means. The process wires each to the module that owns the fact.
 */
export interface CheckupFacts {
  readonly now: () => Instant;
  readonly install: {
    readonly version: string;
    readonly processRole: string;
    readonly environment: string;
  };
  readonly postgres: {
    readonly ping: () => Promise<string>;
    /** Empty where the migration folder is not on this install. */
    readonly findMigrationState: () => Promise<{ pending: string[]; failed: string[] }[]>;
  };
  readonly clickhouse: {
    readonly configured: boolean;
    readonly ping: () => Promise<void>;
    /** Goose's own status output; throws where the binary is absent. */
    readonly migrationStatus: () => Promise<string>;
    /** Empty where ClickHouse did not answer the settings the provisioning probe reads. */
    readonly findAppFunctionsProvisionable: () => Promise<boolean[]>;
  };
  readonly redis: {
    readonly target: string | undefined;
    readonly ready: () => Promise<void>;
  };
  /** Where the gateway is and how to ask it; throws where no owner answered this process. */
  readonly gateway: () => Promise<CheckupGatewayFacts>;
  readonly license: () => Promise<CheckupLicenseView>;
  readonly connect: () => Promise<CheckupConnectView>;
  readonly usageReport: {
    readonly disabled: boolean;
    readonly findIdentity: () => Promise<InstanceIdentityView[]>;
    readonly getEndpoint: () => Promise<string>;
  };
  /** Resolves on any HTTP answer; throws a `HandledError` naming the host otherwise. */
  readonly reach: (url: string) => Promise<void>;
  readonly storage: {
    /** Empty where no project exists to resolve a destination for. */
    readonly findDestination: () => Promise<string[]>;
    readonly probe: () => Promise<void>;
  };
  /** How mail leaves the install; throws where no owner answered this process. */
  readonly email: () => Promise<CheckupEmailFacts>;
  /** The organization's enabled providers, by id and name: a key never leaves its owner. */
  readonly modelProviders: () => Promise<{ id: string; provider: string }[]>;
  /** Throws a `HandledError` carrying `retryAfterSeconds` past the organization's budget. */
  readonly modelProviderBudget: () => Promise<void>;
  readonly testModelProvider: (row: {
    id: string;
    provider: string;
  }) => Promise<ProviderTestOutcome>;
  readonly canary: (name: CanaryName, params: Record<string, string>) => Promise<CanaryAnswer>;
}

const NOT_ASKED_FOR: CheckVerdict = {
  outcome: "unchecked",
  detail:
    "Not run. This check opens a connection or spends money, so it runs only when you ask for it.",
};

/**
 * The checkup of a self-hosted install (specs/self-hosting/checkup/checkup.feature).
 * A check that found the problem answers `refused` with a fix and a docs page;
 * one that could not run answers `unchecked` with the reason, never `verified`.
 */
export class CheckupService {
  private constructor(private readonly facts: CheckupFacts) {}

  static create(facts: CheckupFacts): CheckupService {
    return new CheckupService(facts);
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
          ? this.row(id, () => this.paid(id, input))
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

  private async postgresMigrations(): Promise<CheckVerdict> {
    const [state] = await this.facts.postgres.findMigrationState();
    if (!state) {
      return {
        outcome: "unchecked",
        detail:
          "The migration folder is not on this install, so pending migrations cannot be compared.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    if (state.failed.length > 0) {
      return {
        outcome: "refused",
        code: "checkup_postgres_migration_failed",
        detail: `${state.failed.length} migration(s) started and never finished: ${state.failed.join(", ")}.`,
        fix: "Resolve the failed migration with `prisma migrate resolve`, then run `prisma migrate deploy` and restart.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    if (state.pending.length > 0) {
      return {
        outcome: "refused",
        code: "checkup_postgres_migrations_pending",
        detail: `${state.pending.length} migration(s) not applied: ${state.pending.join(", ")}.`,
        fix: "Run `prisma migrate deploy` (the app does this at boot unless SKIP_PRISMA_MIGRATE is set) and restart.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    return { outcome: "verified", detail: "Every migration is applied." };
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
    let status: string;
    try {
      status = await this.facts.clickhouse.migrationStatus();
    } catch (error) {
      return {
        outcome: "unchecked",
        detail: `Migration status could not be read: ${reasonOf(error)}`,
        fix: "Run `pnpm clickhouse:migrate` from the app image, where the goose binary is present, to see and apply pending migrations.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    const pending = status.split("\n").filter((line) => /^\s*Pending\b/i.test(line));
    if (pending.length > 0) {
      return {
        outcome: "refused",
        code: "checkup_clickhouse_migrations_pending",
        detail: `${pending.length} ClickHouse migration(s) not applied.`,
        fix: "Run `pnpm clickhouse:migrate` from the app image and restart.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    return { outcome: "verified", detail: "Every ClickHouse migration is applied." };
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
    try {
      await this.facts.redis.ready();
      return { outcome: "verified", detail: `Redis answers at ${target}.` };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_redis_unreachable",
        detail: `Redis did not answer at ${target}: ${reasonOf(error)}`,
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
          "This install's license names no hosted service, so there is no sync to check. A license with hosted services adds Instant Evals judging and managed models, and delivers renewals and seat changes without a key to paste.",
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
    const names = [...new Set(providers.map((row) => row.provider))].sort();
    return { outcome: "verified", detail: `Configured: ${names.join(", ")}.` };
  }

  private async paid(id: CheckId, input: ExplicitCheckInput): Promise<CheckVerdict> {
    switch (id) {
      case "reach_connect_host":
        return this.reach((await this.facts.connect()).licenseHost);
      case "reach_gateway_host":
        return this.reach((await this.facts.connect()).gatewayHost);
      case "gateway_control_plane":
        return this.gatewayControlPlane();
      case "storage_probe":
        return this.storageProbe();
      case "smtp_verify":
        return this.smtpVerify();
      case "model_provider_test":
        return this.modelProviderTest();
      case "canary_collector":
        return this.canary("collector", {});
      case "canary_processor":
        return this.canary("processor", {});
      case "canary_evaluations":
        return this.canary("evaluations", {});
      case "canary_scenarios":
        return input.scenarioRunPlanId
          ? this.canary("scenarios", { runPlanId: input.scenarioRunPlanId })
          : {
              outcome: "unchecked",
              detail: "The scenario canary launches a real run and needs a run plan to launch.",
              fix: "Name a run plan id or slug and run this check again.",
            };
      case "canary_langy":
        return this.canary("langy", {});
      default:
        return NOT_ASKED_FOR;
    }
  }

  private async reach(host: string): Promise<CheckVerdict> {
    const url = host.includes("://") ? host : `https://${host}`;
    try {
      await this.facts.reach(url);
      return { outcome: "verified", detail: `${hostOf(url)} answers on port ${portOf(url)}.` };
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      return {
        outcome: "refused",
        code: error.code,
        detail: `${hostOf(url)} could not be reached on port ${portOf(url)}.`,
        fix: error.message,
        docsPath: CHECKUP_DOCS.connect,
        meta: { ...error.meta, host: hostOf(url), port: portOf(url) },
      };
    }
  }

  private async gatewayControlPlane(): Promise<CheckVerdict> {
    const gateway = await this.facts.gateway();
    const expected = gateway.expectedControlPlaneUrl;
    if (!gateway.baseUrl || !expected) {
      return {
        outcome: "unchecked",
        detail: "No AI Gateway is configured, so there is no control plane to compare.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    const probe = await gateway.probeControlPlane();
    if (probe.kind === "unreachable") {
      return {
        outcome: "unchecked",
        detail: `The gateway did not answer GET /debug/control-plane: ${probe.reason}. An older gateway build has no such route.`,
        fix: "Upgrade the gateway to the release that ships with this app, then run this check again.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    if (normalizeUrl(probe.controlPlaneBaseUrl) !== normalizeUrl(expected)) {
      return {
        outcome: "refused",
        code: "checkup_gateway_control_plane_mismatch",
        detail: `The gateway reports its control plane as ${probe.controlPlaneBaseUrl}; this app is at ${expected}. Requests return 200 while budgets, spend and auth apply to another install.`,
        fix: "Point the gateway's control plane at this app (GATEWAY_CONTROL_PLANE_URL on the gateway) and restart it.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    return {
      outcome: "verified",
      detail: `The gateway reports ${probe.controlPlaneBaseUrl} as its control plane, which is this app.`,
    };
  }

  private async storageProbe(): Promise<CheckVerdict> {
    const [destination] = await this.facts.storage.findDestination();
    if (!destination) {
      return {
        outcome: "unchecked",
        detail: "No project exists yet, so there is no storage destination to write to.",
      };
    }
    try {
      await this.facts.storage.probe();
      return {
        outcome: "verified",
        detail: `One object was written to ${destination} and deleted.`,
      };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_storage_write_failed",
        detail: `Writing to ${destination} failed: ${reasonOf(error)}`,
        fix: "Check the bucket or path exists and that the app's credentials allow put and delete on it.",
        docsPath: CHECKUP_DOCS.environment,
      };
    }
  }

  private async smtpVerify(): Promise<CheckVerdict> {
    const email = await this.facts.email();
    if (!email.smtpConfigured) {
      return {
        outcome: "unchecked",
        detail: email.provider
          ? `Email goes through ${email.provider}, which has no connection to verify. Send a test invitation to check it.`
          : "SMTP is not configured.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
    try {
      await email.verifySmtp();
      return {
        outcome: "verified",
        detail: "The SMTP server accepted a connection and the credentials.",
      };
    } catch (error) {
      return {
        outcome: "refused",
        code: "checkup_smtp_refused",
        detail: `The SMTP server refused: ${reasonOf(error)}`,
        fix: "Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
  }

  private async modelProviderTest(): Promise<CheckVerdict> {
    const providers = await this.facts.modelProviders();
    if (providers.length === 0) {
      return {
        outcome: "unchecked",
        detail: "No model provider is configured, so there is nothing to test.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    try {
      await this.facts.modelProviderBudget();
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      const retry = Number(error.meta?.retryAfterSeconds ?? 60);
      return {
        outcome: "unchecked",
        detail: `This organization used its connection test budget for the minute. Try again in ${retry} seconds.`,
      };
    }
    const results = await Promise.all(
      providers.slice(0, 5).map(async (row) => ({
        provider: row.provider,
        result: await this.facts.testModelProvider(row),
      })),
    );
    const refused = results.flatMap((entry) =>
      entry.result.outcome === "refused" ? [{ provider: entry.provider, ...entry.result }] : [],
    );
    const [firstRefusal] = refused;
    if (firstRefusal) {
      return {
        outcome: "refused",
        code: "checkup_model_provider_refused",
        detail:
          `${refused.map((entry) => entry.provider).join(", ")} refused the connection test. ${firstRefusal.message}`.trim(),
        fix: "Open Settings, Model providers, and test the provider there to see the refusal in full.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    const verified = results.filter((entry) => entry.result.outcome === "verified");
    if (verified.length === 0) {
      return {
        outcome: "unchecked",
        detail: `None of the configured providers can be probed from here (${results.map((entry) => entry.provider).join(", ")}).`,
      };
    }
    return {
      outcome: "verified",
      detail: `Connected: ${verified.map((entry) => entry.provider).join(", ")}.`,
    };
  }

  private async canary(name: CanaryName, params: Record<string, string>): Promise<CheckVerdict> {
    const answer = await this.facts.canary(name, params);
    if (answer.status === 404 && name === "langy") {
      return {
        outcome: "unchecked",
        detail: "Langy is not enabled for this project, so there is no turn to send.",
      };
    }
    if (answer.status >= 200 && answer.status < 300) {
      return { outcome: "verified", detail: `The ${name} canary came back healthy.` };
    }
    return {
      outcome: "refused",
      code: `checkup_canary_${name}_failed`,
      detail: `The ${name} canary answered ${answer.status}: ${firstLine(bodyText(answer.body))}`,
      fix: `Read the ${name} logs for the canary's trace, then see the troubleshooting page.`,
      docsPath: CHECKUP_DOCS.troubleshooting,
    };
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

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

function reasonOf(error: unknown): string {
  return firstLine(error instanceof Error ? error.message : String(error ?? "unknown error"));
}

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "message" in body) return String(body.message);
  return JSON.stringify(body ?? null);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function portOf(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "http:" ? 80 : 443;
  } catch {
    return 443;
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
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
