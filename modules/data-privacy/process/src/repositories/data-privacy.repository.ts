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
    scopes: Pick<DataPrivacyRow, "scopeType" | "scopeId" | "personalOnly">[];
  }): Promise<DataPrivacyRow[]>;
  findAllInOrganization(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
  upsertForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy>;
  /**
   * Replaces one rule with what `merge` makes of the stored config (undefined when none is
   * stored), atomically, so a concurrent write is never lost between the read and the write.
   */
  mergeConfigForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    merge: (config: DataPrivacyConfig | undefined) => DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy>;
  deleteForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void>;
}
