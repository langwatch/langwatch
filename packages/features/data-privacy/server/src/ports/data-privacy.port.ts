import type {
  DataPrivacyPolicy,
  DataPrivacyRow,
  DataPrivacyScope,
  DataPrivacyConfig,
} from "@langwatch/data-privacy-contract";

export abstract class DataPrivacyPolicyRepository {
  abstract findForProjectChain(input: {
    organizationId: string;
    scopes: Array<Pick<DataPrivacyRow, "scopeType" | "scopeId" | "personalOnly">>;
  }): Promise<DataPrivacyRow[]>;
  abstract findAllInOrganization(input: {
    organizationId: string;
  }): Promise<DataPrivacyPolicy[]>;
  abstract upsertForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy>;
  abstract deleteForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void>;
  abstract tryFindById(input: { id: string }): Promise<DataPrivacyPolicy | null>;
}
