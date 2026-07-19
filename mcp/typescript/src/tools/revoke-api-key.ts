import { revokeApiKey as apiRevokeApiKey } from "../langwatch-api-api-keys.js";

export async function handleRevokeApiKey(params: {
  id: string;
}): Promise<string> {
  await apiRevokeApiKey(params.id);

  return `API key ${params.id} revoked successfully.`;
}
