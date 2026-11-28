/**
 * Which project an empty search read, for the message that says so. Asked only
 * when a search came back empty, and best-effort: a slow or refused lookup
 * answers null rather than holding up or failing the command.
 */
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { cliAuthHeaders } from "./authHeaders";

const LOOKUP_TIMEOUT_MS = 3_000;

export const searchedProjectSlug = async ({
  project,
}: {
  project: string | undefined;
}): Promise<string | null> => {
  if (project) return project;
  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  try {
    const response = await langwatchFetch(`${resolveControlPlaneUrl()}/api/v1/me/project`, {
      headers: { ...cliAuthHeaders({ apiKey }), Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { slug?: unknown };
    return typeof body.slug === "string" && body.slug !== "" ? body.slug : null;
  } catch {
    return null;
  }
};
