import { makeRequest } from "./langwatch-api.js";
import { getConfig } from "./config.js";

export interface SecretSummary {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function projectId(): string {
  const projectId = getConfig().projectId;
  if (!projectId) {
    throw new Error("LANGWATCH_PROJECT_ID is required for secret operations");
  }
  return projectId;
}

export async function listSecrets(): Promise<SecretSummary[]> {
  const targetProjectId = projectId();
  return makeRequest(
    "GET",
    `/api/v1/secret?projectId=${encodeURIComponent(targetProjectId)}`,
  ) as Promise<SecretSummary[]>;
}

export async function getSecret(id: string): Promise<SecretSummary> {
  const targetProjectId = projectId();
  return makeRequest(
    "GET",
    `/api/v1/secret/${encodeURIComponent(id)}?projectId=${encodeURIComponent(targetProjectId)}`,
  ) as Promise<SecretSummary>;
}

export async function createSecret(data: { name: string; value: string }): Promise<SecretSummary> {
  return makeRequest("POST", "/api/v1/secret", {
    projectId: projectId(),
    ...data,
  }) as Promise<SecretSummary>;
}

export async function updateSecret(params: { id: string; value: string }): Promise<SecretSummary> {
  const { id, value } = params;
  return makeRequest("PUT", `/api/v1/secret/${encodeURIComponent(id)}`, {
    projectId: projectId(),
    value,
  }) as Promise<SecretSummary>;
}

export async function deleteSecret(id: string): Promise<{ id: string; deleted: boolean }> {
  return makeRequest("DELETE", `/api/v1/secret/${encodeURIComponent(id)}`, {
    projectId: projectId(),
  }) as Promise<{ id: string; deleted: boolean }>;
}
