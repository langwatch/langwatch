import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyScope,
  ResolvedDataPrivacy,
} from "./data-privacy";

export abstract class DataPrivacyService {
  abstract getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
  abstract listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
  abstract tryGetById(input: { id: string }): Promise<DataPrivacyPolicy | null>;
  abstract setForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy>;
  abstract removeForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void>;
}
