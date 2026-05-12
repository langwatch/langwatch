import { makeRequest } from "./langwatch-api.js";

export interface SecretSummary {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export async function listSecrets(): Promise<SecretSummary[]> {
  return makeRequest("GET", "/api/secrets") as Promise<SecretSummary[]>;
}

export async function getSecret(id: string): Promise<SecretSummary> {
  return makeRequest(
    "GET",
    `/api/secrets/${encodeURIComponent(id)}`
  ) as Promise<SecretSummary>;
}

export async function createSecret(data: {
  name: string;
  value: string;
}): Promise<SecretSummary> {
  return makeRequest("POST", "/api/secrets", data) as Promise<SecretSummary>;
}

export async function updateSecret(params: {
  id: string;
  value: string;
}): Promise<SecretSummary> {
  const { id, value } = params;
  return makeRequest(
    "PUT",
    `/api/secrets/${encodeURIComponent(id)}`,
    { value }
  ) as Promise<SecretSummary>;
}

export async function deleteSecret(
  id: string
): Promise<{ id: string; deleted: boolean }> {
  return makeRequest(
    "DELETE",
    `/api/secrets/${encodeURIComponent(id)}`
  ) as Promise<{ id: string; deleted: boolean }>;
}
