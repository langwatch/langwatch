import { makeRequest } from "./langwatch-api.js";

export interface RoleBinding {
  id: string;
  role: string;
  scopeType: string;
  scopeId: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  roleBindings: RoleBinding[];
}

export interface ApiKeyCreateResponse {
  token: string;
  apiKey: {
    id: string;
    name: string;
    createdAt: string;
  };
}

export async function listApiKeys(): Promise<{ data: ApiKeySummary[] }> {
  return makeRequest("GET", "/api/api-keys") as Promise<{ data: ApiKeySummary[] }>;
}

export async function createApiKey(data: {
  keyType: "personal" | "service";
  name: string;
  description?: string;
  expiresAt?: string;
  bindings?: Array<{
    role: "ADMIN" | "MEMBER" | "VIEWER";
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  projectIds?: string[];
}): Promise<ApiKeyCreateResponse> {
  return makeRequest("POST", "/api/api-keys", data) as Promise<ApiKeyCreateResponse>;
}

export async function revokeApiKey(id: string): Promise<{ success: boolean }> {
  return makeRequest(
    "DELETE",
    `/api/api-keys/${encodeURIComponent(id)}`,
  ) as Promise<{ success: boolean }>;
}
