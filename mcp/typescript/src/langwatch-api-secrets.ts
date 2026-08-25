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
  return makeRequest("POST", "/api/secrets/latest/secrets.list", {
    projectId: projectId(),
  }) as Promise<SecretSummary[]>;
}

export async function getSecret(id: string): Promise<SecretSummary> {
  return makeRequest("POST", "/api/secrets/latest/secrets.get", {
    projectId: projectId(),
    id,
  }) as Promise<SecretSummary>;
}

export async function createSecret(data: {
  name: string;
  value: string;
}): Promise<SecretSummary> {
  return makeRequest("POST", "/api/secrets/latest/secrets.create", {
    projectId: projectId(),
    ...data,
  }) as Promise<SecretSummary>;
}

export async function updateSecret(params: {
  id: string;
  value: string;
}): Promise<SecretSummary> {
  const { id, value } = params;
  return makeRequest("POST", "/api/secrets/latest/secrets.update", {
    projectId: projectId(),
    id,
    value,
  }) as Promise<SecretSummary>;
}

export async function deleteSecret(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return makeRequest("POST", "/api/secrets/latest/secrets.delete", {
    projectId: projectId(),
    id,
  }) as Promise<{ id: string; deleted: boolean }>;
}
