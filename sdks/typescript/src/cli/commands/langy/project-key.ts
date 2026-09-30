/**
 * The project's key for the credentials call, traded for the developer's device session at
 * POST /api/auth/cli/project-key (the project routes never reveal a base key to an API key).
 * That route names a project by slug, so the id the Langy request carries is looked up first.
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

function asProjectKeyError(stage: "lookup" | "key", error: unknown): ProjectKeyError {
  const { status, httpStatus, code, message } = (error ?? {}) as {
    status?: unknown;
    httpStatus?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const numericStatus = [status, httpStatus].find((value) => typeof value === "number") as
    | number
    | undefined;
  return new ProjectKeyError(
    stage,
    numericStatus,
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

/** The platform reader: the signed-in login finds the slug, the device session gets the key. */
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
