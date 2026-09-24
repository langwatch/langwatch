import { moduleApi } from "@langwatch/kernel/module-api";
import type { OtlpResource, OtlpSpan } from "@langwatch/trace-contract";

import type { DataPrivacySnapshot } from "./data-privacy.snapshot.ts";
import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyScope,
  ResolvedDataPrivacy,
} from "./data-privacy.ts";

/**
 * The signed-in person a scoped privacy write is decided for. Only the id
 * travels: the tRPC runtime hands a handler an actor and nothing else, and
 * anything further about the person is resolved server-side.
 */
export type DataPrivacyCallerInput = { userId: string };

/** The (scope, personalOnly) target one rule hangs on. */
export type DataPrivacyScopeTarget = {
  projectId: string;
  scope: DataPrivacyScope;
  personalOnly: boolean;
};

export type DataPrivacyPiiRedactionLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

export type DataPrivacyLogRecord = {
  body: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  attributeNames?: Record<string, string>;
};

export type DataPrivacyMetricAttributes = {
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  attributeNames?: Record<string, string>;
};

/** What one span's content drop removed: the only record of it, as the span is stored stripped. */
export interface SpanContentDropResult {
  droppedCount: number;
  droppedCategories: string[];
  /** Attribute keys removed by custom attribute rules (names only, deduped). */
  droppedAttributeKeys: string[];
}

/** Callable data-privacy operations shared by process peers after composition. */
export interface DataPrivacyApi {
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
  /**
   * Hands the deployment's Google service-account credential, which this
   * module owns, to `build` — undefined where none is configured — and
   * answers what `build` made of it: the value never leaves the closure.
   */
  intoGoogleApplicationCredentials<Out>(build: (credential: string | undefined) => Out): Out;
  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
  /**
   * The system write, anchored to an organization the caller already resolved.
   * The settings door does not use it: it goes through `setScopeRule`, which
   * authorizes the target scope first.
   */
  setForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy>;
  removeForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void>;

  /**
   * The privacy settings surface. Each operation authorizes the caller against
   * the scope it acts on after anchoring that scope to the acting project's
   * organization, never against the project id the input also carries.
   */
  getSnapshot(input: { projectId: string } & DataPrivacyCallerInput): Promise<DataPrivacySnapshot>;
  setScopeRule(
    input: DataPrivacyScopeTarget & { config: DataPrivacyConfig } & DataPrivacyCallerInput,
  ): Promise<DataPrivacyPolicy>;
  removeScopeRule(input: DataPrivacyScopeTarget & DataPrivacyCallerInput): Promise<void>;

  /**
   * True when this project's resolved policy drops any span content at
   * all — the interlock the ingest edge checks before externalizing inline
   * media, so bytes are never stored for content the policy will discard.
   */
  dropsAnyContent(input: { projectId: string }): Promise<boolean>;

  redactLog(
    input: DataPrivacyLogRecord,
    piiRedactionLevel: DataPrivacyPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
  redactMetricAttributes(
    input: DataPrivacyMetricAttributes,
    piiRedactionLevel: DataPrivacyPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;

  /** Redacts the span and its resource in place, at the level the ingest resolved. */
  redactSpan(input: {
    span: OtlpSpan;
    resource: OtlpResource | null;
    piiRedactionLevel: DataPrivacyPiiRedactionLevel;
    tenantId: string;
  }): Promise<void>;
  /** Strips the content the project's policy never stores; fail-open, never throws. */
  dropSpanContent(input: { span: OtlpSpan; projectId: string }): Promise<SpanContentDropResult>;
}

export const DataPrivacyApi = moduleApi<DataPrivacyApi>()("data-privacy");
