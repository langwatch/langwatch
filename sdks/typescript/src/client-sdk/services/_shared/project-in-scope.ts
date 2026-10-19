/**
 * The project a route that names one should carry. A legacy project key carries its own project,
 * which the resolver never publishes (the server reads it off the token), so it is read from
 * `GET /api/v1/me/project` once per key and endpoint.
 * @see specs/typescript-sdk/cli-cross-project-access.feature
 */
import { createHash } from "node:crypto";

import { isUserScopedApiKey } from "@/internal/api/auth";
import { buildRequestHeaders } from "@/internal/api/request-headers";
import { scopedApiKey, scopedProjectId } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

/** Key fingerprint plus endpoint -> the key's project id. Failed lookups are not kept. */
const keyProjects = new Map<string, Promise<string | undefined>>();

const fetchKeyProject = async ({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string;
}): Promise<string | undefined> => {
  try {
    const response = await langwatchFetch(`${endpoint}/api/v1/me/project`, {
      headers: { ...buildRequestHeaders({ apiKey }), Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id !== "" ? body.id : undefined;
  } catch {
    return undefined;
  }
};

/** The project a legacy project key belongs to; undefined for a user-scoped key or failed read. */
export const keyProjectId = async ({
  apiKey,
  endpoint,
}: {
  apiKey: string | undefined;
  endpoint?: string;
}): Promise<string | undefined> => {
  if (!apiKey || isUserScopedApiKey(apiKey)) return undefined;
  const base = resolveEndpoint(endpoint);
  const cacheKey = `${base}\n${createHash("sha256").update(apiKey).digest("hex")}`;
  const cached = keyProjects.get(cacheKey);
  if (cached) return cached;
  const lookup = fetchKeyProject({ apiKey, endpoint: base });
  keyProjects.set(cacheKey, lookup);
  const projectId = await lookup;
  if (!projectId) keyProjects.delete(cacheKey);
  return projectId;
};

/**
 * The project in scope: the one configured, then the resolver's, then a project key's own (which
 * wins over `LANGWATCH_PROJECT_ID`, as the resolver's warning says), then `LANGWATCH_PROJECT_ID`.
 */
export const projectInScope = async ({
  configuredProjectId,
  apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY,
  endpoint,
}: {
  configuredProjectId: string | undefined;
  apiKey?: string;
  endpoint?: string;
}): Promise<string | undefined> =>
  configuredProjectId ??
  scopedProjectId() ??
  (await keyProjectId({ apiKey, endpoint })) ??
  (process.env.LANGWATCH_PROJECT_ID?.trim() || undefined);
