import type { PersonalFeatures } from "@langwatch/organization-contract";
import { createModuleApi } from "@langwatch/api/web";

export type PersonalWorkspaceFeaturesApiMap = {
  personalWorkspaceFeatures: {
    get: { query: { input: { projectId: string }; output: PersonalFeatures } };
    enableAll: { mutation: { input: { projectId: string }; output: PersonalFeatures } };
    disableAll: { mutation: { input: { projectId: string }; output: PersonalFeatures } };
  };
};

/** The organization-owned progressive unlock for a caller's personal workspace. */
export const personalWorkspaceFeaturesApi = createModuleApi<PersonalWorkspaceFeaturesApiMap>();
