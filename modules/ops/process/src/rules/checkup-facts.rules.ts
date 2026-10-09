import type { InstanceIdentityView } from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";
import type { UpgradeReader } from "@langwatch/upgrade/reader";

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
interface CanaryAnswer {
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

interface CheckupGatewayFacts {
  readonly baseUrl: string | undefined;
  /**
   * Every address this app is reached at, its public address first. The
   * gateway usually reaches the app over the cluster, so its control plane
   * is this app when it names any one of them.
   */
  readonly controlPlaneUrls: string[];
  readonly health: () => Promise<void>;
  readonly probeControlPlane: () => Promise<ControlPlaneProbe>;
}

interface CheckupEmailFacts {
  readonly provider: string | undefined;
  readonly smtpConfigured: boolean;
  /** The transport logs in to the relay; an internal relay often takes none. */
  readonly smtpSendsCredentials: boolean;
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
  };
  /** The upgrade ledger as the Upgrades page reads it; throws where it cannot be read. */
  readonly upgrade: Pick<UpgradeReader, "status" | "listSteps">;
  readonly clickhouse: {
    readonly configured: boolean;
    readonly ping: () => Promise<void>;
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
