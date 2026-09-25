/**
 * The checkup of a self-hosted install
 * (specs/self-hosting/checkup/checkup.feature).
 *
 * One implementation, two readers: the Settings page and `langwatch doctor`
 * both ask this service and print what it says. A check is a function of the
 * dependencies in `CheckupDeps`, never of the ambient process, so a suite can
 * state "Redis does not answer" as an input rather than by breaking Redis.
 *
 * Two rules every check keeps. A check that ran and found the problem answers
 * `refused` with a fix and a docs page; a check that could not run answers
 * `unchecked` with the reason, and never `verified`. And a check that costs
 * egress or money runs only when asked for: the free checks are what the page
 * opens with, the others sit behind a button and behind `--run`.
 */

import { HandledError } from "@langwatch/handled-error";

import {
  CHECK_DEFINITIONS,
  type CheckId,
  type CheckRow,
  type CheckVerdict,
  checkDefinition,
  couldNotRun,
  explicitCheckIds,
  firstLine,
  freeCheckIds,
  notAskedFor,
} from "./verdict";

/** What a control plane probe of the local gateway came back with. */
export type ControlPlaneProbe =
  | { readonly kind: "ok"; readonly controlPlaneBaseUrl: string }
  | { readonly kind: "unreachable"; readonly reason: string };

/** What a model provider connection test came back with. */
export type ProviderTestOutcome =
  | { readonly outcome: "verified" }
  | {
      readonly outcome: "refused";
      readonly code: string;
      readonly message: string;
    }
  | { readonly outcome: "unchecked"; readonly reason: string };

/** What a canary route answered. */
export interface CanaryAnswer {
  readonly status: number;
  readonly body: unknown;
}

export type CanaryName =
  | "collector"
  | "processor"
  | "evaluations"
  | "scenarios"
  | "langy";

/** Where the daily license sync stands, as the connect settings report it. */
export interface ConnectView {
  readonly deployment: "off" | "on";
  readonly licensed: boolean;
  readonly entitledServices: string[] | null;
  readonly lastSyncAt: string | null;
  readonly lastSyncError: string | null;
  readonly licenseHost: string;
  readonly gatewayHost: string;
}

export interface LicenseView {
  readonly hasLicense: boolean;
  readonly valid: boolean;
  readonly expired?: boolean;
  readonly corrupted?: boolean;
  readonly planName?: string;
  readonly expiresAt?: string | null;
  readonly currentMembers?: number;
  readonly maxMembers?: number;
}

export interface IdentityView {
  readonly instanceId: string;
  readonly createdAt: Date;
  readonly lastReportAt: Date | null;
  readonly lastReportError: string | null;
  readonly optionalMetricsOptOut: boolean;
  readonly hostnameOptOut: boolean;
}

/**
 * Everything a check reads, injected.
 *
 * Every probe either resolves or throws; the check decides what a throw
 * means. Each field is one fact or one probe, so a suite states the world in
 * a few lines and the real composition (`checkup.deps.ts`) wires each one to
 * the module that already owns it.
 */
export interface CheckupDeps {
  readonly organizationId: string;
  readonly now: () => Date;
  readonly install: {
    readonly version: string;
    readonly processRole: string | undefined;
    readonly environment: string;
  };
  readonly postgres: {
    readonly ping: () => Promise<string>;
    /** Null where the migration folder is not on this install. */
    readonly migrations: () => Promise<{
      pending: string[];
      failed: string[];
    } | null>;
  };
  readonly clickhouse: {
    readonly configured: boolean;
    readonly ping: () => Promise<void>;
    /** Goose's own status output; throws where the binary is absent. */
    readonly migrationStatus: () => Promise<string>;
    readonly appFunctionsProvisionable: () => Promise<boolean | null>;
  };
  readonly redis: {
    readonly target: string | null;
    readonly ready: () => Promise<void>;
  };
  readonly gateway: {
    readonly baseUrl: string | null;
    readonly expectedControlPlaneUrl: string | null;
    readonly health: () => Promise<void>;
    readonly probeControlPlane: () => Promise<ControlPlaneProbe>;
  };
  readonly license: () => Promise<LicenseView>;
  readonly connect: () => Promise<ConnectView>;
  readonly identity: () => Promise<IdentityView | null>;
  readonly usageReportsDisabled: boolean;
  readonly usageReportEndpoint: () => Promise<string>;
  /** Resolves on any HTTP answer; throws a `HandledError` otherwise. */
  readonly reach: (url: string) => Promise<void>;
  readonly storage: {
    readonly destination: () => Promise<string | null>;
    readonly probe: () => Promise<void>;
  };
  readonly email: {
    readonly provider: string | null;
    readonly smtpConfigured: boolean;
    readonly verifySmtp: () => Promise<void>;
  };
  readonly modelProviders: () => Promise<
    { id: string; provider: string; customKeys: Record<string, string> }[]
  >;
  /** Throws `ModelProviderTestRateLimitedError` past the budget. */
  readonly modelProviderBudget: () => Promise<void>;
  readonly testModelProvider: (
    provider: string,
    customKeys: Record<string, string>,
  ) => Promise<ProviderTestOutcome>;
  readonly canary: (
    name: CanaryName,
    params: Record<string, string>,
  ) => Promise<CanaryAnswer>;
}

/** What an explicit run may be given. */
export interface ExplicitCheckInput {
  readonly checks?: CheckId[];
  /** The run plan the scenario canary launches. Without it, not checked. */
  readonly scenarioRunPlanId?: string;
}

export interface CheckupResult {
  readonly ranAt: string;
  readonly rows: CheckRow[];
}

export const CHECKUP_DOCS = {
  checkup: "/self-hosting/checkup",
  connect: "/self-hosting/connect",
  telemetry: "/self-hosting/data-and-telemetry",
  upgrade: "/self-hosting/upgrade",
  troubleshooting: "/self-hosting/troubleshooting",
  email: "/self-hosting/configuration/email",
  environment: "/self-hosting/configuration/environment-variables",
  licensing: "/self-hosting/licensing",
  modelProviders: "/self-hosting/configuration/environment-variables",
  gateway: "/ai-gateway/self-hosting/overview",
  lwql: "/self-hosting/troubleshooting",
} as const;

export class CheckupService {
  constructor(private readonly deps: CheckupDeps) {}

  /** The free checks, which are what the page opens with. */
  async cheap(): Promise<CheckupResult> {
    const rows = await Promise.all(
      freeCheckIds().map((id) => this.row(id, () => this.free(id))),
    );
    const explicit = explicitCheckIds().map((id) => ({
      ...checkDefinition(id),
      verdict: notAskedFor(),
    }));
    return {
      ranAt: this.deps.now().toISOString(),
      rows: inDefinitionOrder([...rows, ...explicit]),
    };
  }

  /** The checks that cost egress or money, run because someone asked. */
  async explicit(input: ExplicitCheckInput = {}): Promise<CheckupResult> {
    const wanted = new Set(input.checks ?? explicitCheckIds());
    const rows = await Promise.all(
      explicitCheckIds().map((id) =>
        wanted.has(id)
          ? this.row(id, () => this.paid(id, input))
          : Promise.resolve({ ...checkDefinition(id), verdict: notAskedFor() }),
      ),
    );
    return { ranAt: this.deps.now().toISOString(), rows };
  }

  private async row(
    id: CheckId,
    run: () => Promise<CheckVerdict>,
  ): Promise<CheckRow> {
    let verdict: CheckVerdict;
    try {
      verdict = await run();
    } catch (error) {
      verdict = couldNotRun(error);
    }
    return { ...checkDefinition(id), verdict };
  }

  // ── free checks ─────────────────────────────────────────────────────

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
        return notAskedFor();
    }
  }

  private app(): CheckVerdict {
    const { version, processRole, environment } = this.deps.install;
    return {
      outcome: "verified",
      detail: `Release ${version}, running as the ${processRole ?? "web"} process, ${environment} environment.`,
    };
  }

  private async postgres(): Promise<CheckVerdict> {
    try {
      const serverVersion = await this.deps.postgres.ping();
      return {
        outcome: "verified",
        detail: `Postgres ${serverVersion} answers.`,
      };
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
    const state = await this.deps.postgres.migrations();
    if (state === null) {
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
    if (!this.deps.clickhouse.configured) {
      return {
        outcome: "refused",
        code: "checkup_clickhouse_not_configured",
        detail: "CLICKHOUSE_URL is not set.",
        fix: "Set CLICKHOUSE_URL to the ClickHouse this install stores traces in and restart.",
        docsPath: CHECKUP_DOCS.environment,
      };
    }
    try {
      await this.deps.clickhouse.ping();
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
    if (!this.deps.clickhouse.configured) {
      return { outcome: "unchecked", detail: "ClickHouse is not configured." };
    }
    let status: string;
    try {
      status = await this.deps.clickhouse.migrationStatus();
    } catch (error) {
      return {
        outcome: "unchecked",
        detail: `Migration status could not be read: ${reasonOf(error)}`,
        fix: "Run `pnpm clickhouse:migrate` from the app image, where the goose binary is present, to see and apply pending migrations.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    const pending = status
      .split("\n")
      .filter((line) => /^\s*Pending\b/i.test(line));
    if (pending.length > 0) {
      return {
        outcome: "refused",
        code: "checkup_clickhouse_migrations_pending",
        detail: `${pending.length} ClickHouse migration(s) not applied.`,
        fix: "Run `pnpm clickhouse:migrate` from the app image and restart.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    return {
      outcome: "verified",
      detail: "Every ClickHouse migration is applied.",
    };
  }

  private async lwql(): Promise<CheckVerdict> {
    if (!this.deps.clickhouse.configured) {
      return { outcome: "unchecked", detail: "ClickHouse is not configured." };
    }
    const provisionable =
      await this.deps.clickhouse.appFunctionsProvisionable();
    if (provisionable === null) {
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
    const target = this.deps.redis.target;
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
      await this.deps.redis.ready();
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
    const baseUrl = this.deps.gateway.baseUrl;
    if (!baseUrl) {
      return {
        outcome: "unchecked",
        detail:
          "No AI Gateway is configured (LW_GATEWAY_BASE_URL is not set). Model traffic is observed, not routed.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    try {
      await this.deps.gateway.health();
      return {
        outcome: "verified",
        detail: `The gateway at ${baseUrl} answers.`,
      };
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
    const license = await this.deps.license();
    if (!license.hasLicense) {
      return {
        outcome: "unchecked",
        detail:
          "No license is installed. The install runs on the open source baseline.",
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
        detail: `The license expired on ${licenseDay(license.expiresAt) ?? "an unknown date"}.`,
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
      detail: `${license.planName ?? "Licensed"} until ${licenseDay(license.expiresAt) ?? "no expiry"}${seats}.`,
    };
  }

  private async connect(): Promise<CheckVerdict> {
    const view = await this.deps.connect();
    if (view.deployment === "off") {
      return {
        outcome: "unchecked",
        detail:
          "Switched off by LANGWATCH_CONNECT_DISABLED. This install opens no connection to LangWatch, whatever its license says.",
        fix: "Unset LANGWATCH_CONNECT_DISABLED (Helm: app.connect.disabled) and restart to let the license decide.",
        docsPath: CHECKUP_DOCS.connect,
      };
    }
    if (!view.licensed || (view.entitledServices ?? []).length === 0) {
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
      detail: `Last sync ${view.lastSyncAt} with ${view.licenseHost}. Services: ${(view.entitledServices ?? []).join(", ")}.`,
    };
  }

  private async usageReport(): Promise<CheckVerdict> {
    if (this.deps.usageReportsDisabled) {
      return {
        outcome: "unchecked",
        detail:
          "Switched off with DISABLE_USAGE_STATS. No usage report leaves this install.",
        docsPath: CHECKUP_DOCS.telemetry,
      };
    }
    const [identity, endpoint] = await Promise.all([
      this.deps.identity(),
      this.deps.usageReportEndpoint(),
    ]);
    if (identity?.lastReportError) {
      const host = hostOf(endpoint);
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
        detail: `No report has been sent yet. The first one goes to ${hostOf(endpoint)} at the next 12:00 UTC.`,
        docsPath: CHECKUP_DOCS.telemetry,
      };
    }
    return {
      outcome: "verified",
      detail: `Last report ${identity.lastReportAt.toISOString()} to ${hostOf(endpoint)}.`,
    };
  }

  private async storage(): Promise<CheckVerdict> {
    const destination = await this.deps.storage.destination();
    if (!destination) {
      return {
        outcome: "unchecked",
        detail:
          "No project exists yet, so there is no storage destination to resolve.",
      };
    }
    return {
      outcome: "verified",
      detail: `Stored objects go to ${destination}.`,
    };
  }

  private email(): CheckVerdict {
    const provider = this.deps.email.provider;
    if (!provider) {
      return {
        outcome: "refused",
        code: "checkup_email_not_configured",
        detail:
          "No email provider is configured. Invitations and alerts cannot be sent.",
        fix: "Set EMAIL_PROVIDER to smtp, ses, sendgrid or resend with its credentials, and restart.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
    return { outcome: "verified", detail: `Email goes through ${provider}.` };
  }

  private async modelProviders(): Promise<CheckVerdict> {
    const providers = await this.deps.modelProviders();
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

  // ── explicit checks ─────────────────────────────────────────────────

  private async paid(
    id: CheckId,
    input: ExplicitCheckInput,
  ): Promise<CheckVerdict> {
    switch (id) {
      case "reach_connect_host":
        return this.reach((await this.deps.connect()).licenseHost);
      case "reach_gateway_host":
        return this.reach((await this.deps.connect()).gatewayHost);
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
              detail:
                "The scenario canary launches a real run and needs a run plan to launch.",
              fix: "Name a run plan id or slug and run this check again.",
            };
      case "canary_langy":
        return this.canary("langy", {});
      default:
        return notAskedFor();
    }
  }

  private async reach(host: string): Promise<CheckVerdict> {
    const url = host.includes("://") ? host : `https://${host}`;
    try {
      await this.deps.reach(url);
      return {
        outcome: "verified",
        detail: `${hostOf(url)} answers on port ${portOf(url)}.`,
      };
    } catch (error) {
      if (HandledError.isHandled(error)) {
        return {
          outcome: "refused",
          code: error.code,
          detail: `${hostOf(url)} could not be reached on port ${portOf(url)}.`,
          fix: error.message,
          docsPath: CHECKUP_DOCS.connect,
          meta: { ...(error.meta ?? {}), host: hostOf(url), port: portOf(url) },
        };
      }
      throw error;
    }
  }

  private async gatewayControlPlane(): Promise<CheckVerdict> {
    const expected = this.deps.gateway.expectedControlPlaneUrl;
    if (!this.deps.gateway.baseUrl || !expected) {
      return {
        outcome: "unchecked",
        detail:
          "No AI Gateway is configured, so there is no control plane to compare.",
        docsPath: CHECKUP_DOCS.gateway,
      };
    }
    const probe = await this.deps.gateway.probeControlPlane();
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
    const destination = await this.deps.storage.destination();
    if (!destination) {
      return {
        outcome: "unchecked",
        detail:
          "No project exists yet, so there is no storage destination to write to.",
      };
    }
    try {
      await this.deps.storage.probe();
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
    if (!this.deps.email.smtpConfigured) {
      return {
        outcome: "unchecked",
        detail: this.deps.email.provider
          ? `Email goes through ${this.deps.email.provider}, which has no connection to verify. Send a test invitation to check it.`
          : "SMTP is not configured.",
        docsPath: CHECKUP_DOCS.email,
      };
    }
    try {
      await this.deps.email.verifySmtp();
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
    const providers = await this.deps.modelProviders();
    if (providers.length === 0) {
      return {
        outcome: "unchecked",
        detail: "No model provider is configured, so there is nothing to test.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    try {
      await this.deps.modelProviderBudget();
    } catch (error) {
      if (HandledError.isHandled(error)) {
        const retry = Number(
          (error.meta as { retryAfterSeconds?: number } | undefined)
            ?.retryAfterSeconds ?? 60,
        );
        return {
          outcome: "unchecked",
          detail: `This organization used its connection test budget for the minute. Try again in ${retry} seconds.`,
        };
      }
      throw error;
    }
    const results = await Promise.all(
      providers.slice(0, 5).map(async (row) => ({
        provider: row.provider,
        result: await this.deps.testModelProvider(row.provider, row.customKeys),
      })),
    );
    const refused = results.filter(
      (entry) => entry.result.outcome === "refused",
    );
    if (refused.length > 0) {
      const first = refused[0]!;
      const message =
        first.result.outcome === "refused" ? first.result.message : "";
      return {
        outcome: "refused",
        code: "checkup_model_provider_refused",
        detail:
          `${refused.map((entry) => entry.provider).join(", ")} refused the connection test. ${message}`.trim(),
        fix: "Open Settings, Model providers, and test the provider there to see the refusal in full.",
        docsPath: CHECKUP_DOCS.modelProviders,
      };
    }
    const verified = results.filter(
      (entry) => entry.result.outcome === "verified",
    );
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

  private async canary(
    name: CanaryName,
    params: Record<string, string>,
  ): Promise<CheckVerdict> {
    const answer = await this.deps.canary(name, params);
    if (answer.status === 404 && name === "langy") {
      return {
        outcome: "unchecked",
        detail:
          "Langy is not enabled for this project, so there is no turn to send.",
      };
    }
    if (answer.status >= 200 && answer.status < 300) {
      return {
        outcome: "verified",
        detail: `The ${name} canary came back healthy.`,
      };
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

/** Masks the user and password of every URL in the text before a row shows it. */
function withoutUserInfo(text: string): string {
  return text.replace(/(\/\/)[^/@\s]+@/g, "$1***@");
}

function reasonOf(error: unknown): string {
  return firstLine(error instanceof Error ? error.message : String(error));
}

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "message" in body) {
    return String((body as { message: unknown }).message);
  }
  return JSON.stringify(body ?? null);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function portOf(url: string): number {
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
function licenseDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
