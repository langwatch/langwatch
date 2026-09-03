import {
  type DataPrivacyConfig,
  type DataPrivacyPolicy,
  type DataPrivacyScope,
  type ResolvedDataPrivacy,
  DataPrivacyService,
} from "@langwatch/data-privacy-contract";

/** Complete contract fake for Trace redaction tests that only resolve policy. */
export class DataPrivacyServiceFake extends DataPrivacyService {
  constructor(private readonly resolved: ResolvedDataPrivacy) {
    super();
  }

  async getResolvedForProject(): Promise<ResolvedDataPrivacy> {
    return this.resolved;
  }

  async listOrganizationRules(): Promise<DataPrivacyPolicy[]> {
    return [];
  }

  async tryGetById(): Promise<DataPrivacyPolicy | null> {
    return null;
  }

  async setForScope(_input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    throw new Error("DataPrivacyServiceFake does not support policy writes");
  }

  async removeForScope(): Promise<void> {
    throw new Error("DataPrivacyServiceFake does not support policy writes");
  }
}
