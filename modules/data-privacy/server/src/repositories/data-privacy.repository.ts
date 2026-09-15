import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyRow,
  DataPrivacyScope,
} from "@langwatch/data-privacy-contract";

/** The stored privacy rules, as the cascade and the settings page read them. */
export interface DataPrivacyPolicyRepository {
  findForProjectChain(input: {
    organizationId: string;
    scopes: Array<Pick<DataPrivacyRow, "scopeType" | "scopeId" | "personalOnly">>;
  }): Promise<DataPrivacyRow[]>;
  findAllInOrganization(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
  upsertForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy>;
  deleteForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void>;
}
