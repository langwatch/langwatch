/**
 * The project's LangWatch key for the credentials call, fetched with the
 * developer's own device session. The project routes never reveal a base key
 * to an API key, the organization key this command also holds included, so
 * the key comes from POST /api/auth/cli/project-key, which answers a signed-in
 * person with project administration on that project. That route names a
 * project by slug and the Langy request names it by id, so the id is looked up
 * first.
 */

import { ProjectsApiService } from "../../../client-sdk/services/projects/projects-api.service";
import { loadConfig } from "../../utils/governance/config";
import { fetchProjectKeyBySlug } from "../../utils/governance/session-api";

export interface ProjectKeySources {
  /** The project's slug, read with the credentials the command signed in with. */
  lookupSlug: (projectId: string) => Promise<string>;
  /** The project's key, traded for the device session. */
  fetchKeyBySlug: (slug: string) => Promise<string>;
}

/** Reads a project's key by id. A 401 or 403 on the way keeps its status for the caller. */
export function createProjectKeyReader(
  sources: ProjectKeySources,
): (projectId: string) => Promise<string> {
  return async (projectId) => sources.fetchKeyBySlug(await sources.lookupSlug(projectId));
}

/** The reader over the platform: the signed-in credentials for the lookup, the device session for the key. */
export function platformProjectKeyReader({
  endpoint,
  apiKey,
}: {
  endpoint: string;
  apiKey: string;
}): (projectId: string) => Promise<string> {
  const projects = new ProjectsApiService({ endpoint, apiKey });
  return createProjectKeyReader({
    lookupSlug: async (projectId) => (await projects.get(projectId)).slug,
    fetchKeyBySlug: async (slug) => (await fetchProjectKeyBySlug(loadConfig(), slug)).api_key,
  });
}
