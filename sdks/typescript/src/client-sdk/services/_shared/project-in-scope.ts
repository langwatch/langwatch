/**
 * The project a route that names one should carry. A legacy project key's own project is read
 * from `GET /api/v1/me/project` once per key and endpoint (the resolver never publishes it).
 * @see specs/typescript-sdk/cli-cross-project-access.feature
 */
import { isUserScopedApiKey } from "@/internal/api/auth";
import { buildRequestHeaders } from "@/internal/api/request-headers";
import { scopedApiKey, scopedProjectId } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import { langwatchFetch } from "@/internal/http/langwatchFetch";
import { ConsoleLogger, type Logger } from "@/logger";

/** Endpoint plus key -> the key's project id. Failed lookups are not kept. */
const keyProjects = new Map<string, Promise<string | undefined>>();

/** Same bound as the CLI identity notice reading the same endpoint. */
const KEY_PROJECT_TIMEOUT_MS = 1_500;

const defaultLogger: Logger = new ConsoleLogger({ level: "warn", prefix: "LangWatch" });

const warnLookupFailed = ({ logger, reason }: { logger: Logger; reason: string }): void => {
  logger.warn(`Could not read the API key's project from /api/v1/me/project (${reason}).`);
};

const fetchKeyProject = async ({
  apiKey,
  endpoint,
  logger,
}: {
  apiKey: string;
  endpoint: string;
  logger: Logger;
}): Promise<string | undefined> => {
  try {
    const response = await langwatchFetch(`${endpoint}/api/v1/me/project`, {
      headers: { ...buildRequestHeaders({ apiKey }), Accept: "application/json" },
      signal: AbortSignal.timeout(KEY_PROJECT_TIMEOUT_MS),
    });
    if (!response.ok) {
      warnLookupFailed({ logger, reason: `HTTP ${response.status}` });
      return undefined;
    }
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id !== "" ? body.id : undefined;
  } catch (error) {
    warnLookupFailed({ logger, reason: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
};

/** The project a legacy project key belongs to; undefined for a user-scoped key or failed read. */
export const keyProjectId = async ({
  apiKey,
  endpoint,
  logger = defaultLogger,
}: {
  apiKey: string | undefined;
  endpoint?: string;
  logger?: Logger;
}): Promise<string | undefined> => {
  if (!apiKey || isUserScopedApiKey(apiKey)) return undefined;
  const base = resolveEndpoint(endpoint);
  const cacheKey = `${base}\n${apiKey}`;
  const cached = keyProjects.get(cacheKey);
  if (cached) return cached;
  const lookup = fetchKeyProject({ apiKey, endpoint: base, logger });
  keyProjects.set(cacheKey, lookup);
  const projectId = await lookup;
  if (!projectId) keyProjects.delete(cacheKey);
  return projectId;
};

/** `LANGWATCH_PROJECT_ID`, with an empty or whitespace-only value read as unset. */
const envProjectId = (): string | undefined => {
  const value = process.env.LANGWATCH_PROJECT_ID?.trim();
  return value === "" ? undefined : value;
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
  envProjectId();
