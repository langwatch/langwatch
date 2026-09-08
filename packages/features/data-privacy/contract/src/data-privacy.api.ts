import { featureApi } from "@langwatch/runtime-composition";
import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyScope,
  ResolvedDataPrivacy,
} from "./data-privacy.ts";
import type { DataPrivacySnapshot } from "./data-privacy.snapshot.ts";

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

/** Callable data-privacy operations shared by process peers after composition. */
export interface DataPrivacyApi {
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
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
   * True when this project's resolved policy drops any span content at all —
   * the interlock the ingest edge asks before it externalizes inline media,
   * because storing bytes for a project whose policy is about to discard them
   * keeps exactly what the customer asked us not to.
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
}

export const DataPrivacyApi = featureApi<DataPrivacyApi>("data-privacy");
