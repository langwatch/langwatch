import { featureApi } from "@langwatch/runtime-composition/contract";
import type { ApiKeyService } from "./api-key.service.ts";
import type {
  ApiKey,
  ApiKeyName,
  ApiKeyProject,
  ApiKeyTeam,
  ApiKeyUser,
  CreateApiKeyInput,
  UpdateApiKeyInput,
} from "./api-key.ts";
import type { ApiKeyListEntry, NamedApiKeyBinding } from "./api-key.list.ts";

export type ApiKeyManagementCaller = Readonly<{ id: string }>;
export type CreateApiKeyManagementInput = Readonly<{
  organizationId: string;
  name: string;
  description?: string | undefined;
  expiresAt?: Date | undefined;
  permissionMode: string;
  keyType: "personal" | "service";
  assignedToUserId?: string | undefined;
  permissions?: CreateApiKeyInput["permissions"];
  bindings: CreateApiKeyInput["bindings"];
}>;
export type UpdateApiKeyManagementInput = Readonly<{
  organizationId: string;
  apiKeyId: string;
  name?: string | undefined;
  description?: string | null | undefined;
  permissionMode?: UpdateApiKeyInput["permissionMode"];
  permissions?: UpdateApiKeyInput["permissions"];
  bindings?: UpdateApiKeyInput["bindings"];
}>;

export interface ApiKeyApi extends ApiKeyService {
  listCallerBindings(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<NamedApiKeyBinding[]>;
  getKeyName(
    input: { organizationId: string; apiKeyId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyName | null>;
  listKeys(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyListEntry[]>;
  createKey(
    input: CreateApiKeyManagementInput,
    by: ApiKeyManagementCaller,
  ): Promise<{ token: string; apiKey: ApiKey; assignedToUserId: string | null }>;
  updateKey(input: UpdateApiKeyManagementInput, by: ApiKeyManagementCaller): Promise<ApiKey>;
  revokeKey(
    input: { organizationId: string; apiKeyId: string },
    by: ApiKeyManagementCaller,
  ): Promise<void>;
  listOrganizationProjects(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyProject[]>;
  listOrganizationTeams(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyTeam[]>;
  listOrganizationMembers(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyUser[]>;
}

export const ApiKeyApi = featureApi<ApiKeyApi>("api-key");
