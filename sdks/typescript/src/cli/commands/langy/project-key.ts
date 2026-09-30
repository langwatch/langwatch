/**
 * The project's key, fetched with the developer's own device session from
 * POST /api/auth/cli/project-key (project administration required). The route
 * takes a slug and the Langy request an id, so the id is looked up first.
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

/**
 * A failure on the way to the key, naming the step that failed: the lookup
 * answers to the permission to view the project, the key to the permission to
 * manage it, so the caller's guidance depends on which one refused.
 */
export class ProjectKeyError extends Error {
  constructor(
    readonly stage: "lookup" | "key",
    readonly status: number | undefined,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ProjectKeyError";
  }
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asProjectKeyError(stage: "lookup" | "key", error: unknown): ProjectKeyError {
  const { status, httpStatus, code, message } = (error ?? {}) as {
    status?: unknown;
    httpStatus?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return new ProjectKeyError(
    stage,
    pickNumber(status) ?? pickNumber(httpStatus),
    typeof code === "string" ? code : undefined,
    typeof message === "string" ? message : "the project's key could not be read",
  );
}

/** Reads a project's key by id. A failure keeps its status and names the step that failed. */
export function createProjectKeyReader(
  sources: ProjectKeySources,
): (projectId: string) => Promise<string> {
  return async (projectId) => {
    let slug: string;
    try {
      slug = await sources.lookupSlug(projectId);
    } catch (error) {
      throw asProjectKeyError("lookup", error);
    }
    try {
      return await sources.fetchKeyBySlug(slug);
    } catch (error) {
      throw asProjectKeyError("key", error);
    }
  };
}

/** The reader over the platform: signed-in credentials look up, the device session fetches. */
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
