/** Resolves a --project id/slug to the project id; spec in cli-cross-project-access.feature. */

import {
  ProjectsApiService,
  type Project,
} from "@/client-sdk/services/projects/projects-api.service";

import type { GovernanceConfig } from "./governance/config";

/** Error on --project resolution: code is not_accessible or lookup_failed. */
export class ProjectScopeError extends Error {
  constructor(
    public readonly code:
      | "project_not_accessible"
      | "project_lookup_failed"
      | "project_scope_not_supported",
    message: string,
    /** The `--project` value the user typed, echoed back for the message. */
    public readonly project: string,
    /**
     * The way out, in the words of the credential actually in hand: telling
     * someone to unset an environment variable they never set sends them
     * after a key that is not the one answering.
     */
    public readonly remediation: string[] = [],
  ) {
    super(message);
    this.name = "ProjectScopeError";
  }
}

/** Projects fetched per request. High enough that one page covers most orgs. */
const PAGE_SIZE = 100;

/** Hard stop on the page walk, so a miscounting server cannot loop forever. */
const MAX_PAGES = 50;

/** The status the platform answered with, whichever error class carried it. */
const statusOf = (error: unknown): number | undefined => {
  const candidate = error as { httpStatus?: unknown; status?: unknown };
  if (typeof candidate?.httpStatus === "number") return candidate.httpStatus;
  if (typeof candidate?.status === "number") return candidate.status;
  return undefined;
};

/**
 * Every project the current credential can view, walked page by page. The
 * listing is filtered server-side by what the credential holds `project:view`
 * on, so "not in here" and "not yours" are the same fact.
 */
const listAccessibleProjects = async (service: ProjectsApiService): Promise<Project[]> => {
  const collected: Project[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await service.list({ page, limit: PAGE_SIZE });
    collected.push(...result.data);
    if (page >= (result.pagination.totalPages || 1)) break;
    if (result.data.length === 0) break;
    // The cap is reached with pages still to walk: the listing is
    // incomplete, so "not in here" would be a wrong answer rather than a
    // slow one. Say the lookup failed instead of reporting a project the
    // credential CAN see as inaccessible.
    if (page === MAX_PAGES) {
      throw new ProjectScopeError(
        "project_lookup_failed",
        `More than ${MAX_PAGES * PAGE_SIZE} projects to search. Pass --project with the project id instead of the slug.`,
        "",
      );
    }
  }
  return collected;
};

/** Resolves a --project selector to id; checks personal first, then listing. */
export const resolveProjectSelector = async ({
  selector,
  cfg,
  service,
}: {
  selector: string;
  cfg?: GovernanceConfig;
  service?: ProjectsApiService;
}): Promise<string> => {
  const wanted = selector.trim();
  if (wanted === "") {
    throw new ProjectScopeError(
      "project_not_accessible",
      "--project needs a project id or slug.",
      wanted,
    );
  }

  const personal = cfg?.personal_project;
  if (personal?.id && (personal.id === wanted || personal.slug === wanted)) {
    return personal.id;
  }

  let projects: Project[];
  try {
    projects = await listAccessibleProjects(service ?? new ProjectsApiService());
  } catch (error) {
    const status = statusOf(error);
    if (status === 401 || status === 403) {
      throw new ProjectScopeError(
        "project_not_accessible",
        `your login key has no access to project "${wanted}".`,
        wanted,
      );
    }
    throw new ProjectScopeError(
      "project_lookup_failed",
      `could not look up project "${wanted}": ${(error as Error).message}`,
      wanted,
    );
  }

  const matched =
    projects.find((project) => project.id === wanted) ??
    projects.find((project) => project.slug === wanted);
  if (matched) return matched.id;

  throw new ProjectScopeError(
    "project_not_accessible",
    `no accessible project matches "${wanted}". Your login key has no access to a project with that id or slug.`,
    wanted,
  );
};

/**
 * Where the key in hand came from, which decides the advice when it cannot be pointed at the named
 * project: drop `--api-key`, or unset `LANGWATCH_API_KEY`.
 */
export type BoundKeySource = "flag-key" | "env-key" | "personal-project-login";

/** The sentence and the way out, per credential the request could be holding. */
const BOUND_KEY_COPY: Record<
  BoundKeySource,
  { refusal: (selector: string) => string; remediation: string[] }
> = {
  "flag-key": {
    refusal: (selector) =>
      `the key passed with --api-key is a project key, which carries its own project, so it cannot be pointed at "${selector}".`,
    remediation: [
      "Drop --api-key and run as your login, which reaches every project you approved:",
      "  langwatch login",
    ],
  },
  "env-key": {
    refusal: (selector) =>
      `LANGWATCH_API_KEY is a project key, which carries its own project, so it cannot be pointed at "${selector}".`,
    remediation: [
      "Log in with a key that reaches more than one project:",
      "  langwatch login",
      "",
      "A key in LANGWATCH_API_KEY or .env is used ahead of that login, so unset it first.",
    ],
  },
  "personal-project-login": {
    refusal: (selector) =>
      `this login reaches only your personal project, so it cannot be pointed at "${selector}".`,
    remediation: [
      "Log in again so the CLI mints a key that reaches every project you approve:",
      "  langwatch login",
    ],
  },
};

/**
 * The refusal for a project named against a legacy project key (`sk-lw-`, no lookup id), whose
 * project the server reads off the token; running anyway would silently answer from elsewhere.
 */
export const projectScopeNotSupported = ({
  selector,
  keySource,
}: {
  selector: string;
  keySource: BoundKeySource;
}): ProjectScopeError => {
  const copy = BOUND_KEY_COPY[keySource];
  return new ProjectScopeError(
    "project_scope_not_supported",
    copy.refusal(selector),
    selector,
    copy.remediation,
  );
};

/** The human error block for a `--project` that did not resolve. */
export const projectScopeErrorLines = (error: ProjectScopeError): string[] => {
  if (error.code === "project_scope_not_supported") {
    return [`Error: ${error.message}`, "", ...error.remediation];
  }
  return [
    `Error: ${error.message}`,
    "",
    "List the projects your login reaches:",
    "  langwatch projects list",
  ];
};
