import { featureApi } from "@langwatch/runtime-composition";
import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyScope,
  ResolvedDataPrivacy,
} from "./data-privacy.ts";

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
  tryGetById(input: { id: string }): Promise<DataPrivacyPolicy | null>;
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
