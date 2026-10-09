/**
 * Turns a `--project <idOrSlug>` value into the project id a command targets.
 *
 * The user-scoped login key (`cli_api_key`) reaches every project the user
 * selected while approving the login, but it carries no project identity of
 * its own: the server resolves the role binding from the project the REQUEST
 * names. So a command that runs against another project needs an id, and the
 * user is entitled to type the slug they see in the URL bar instead.
 *
 * One resolver for every command group. `--project` starts on the `trace`
 * commands and `session events`; anything that adopts the flag later passes
 * the value to `resolveCredentials({ project })` and gets the same lookup, the
 * same errors and the same wiring for free.
 *
 * Spec: specs/typescript-sdk/cli-cross-project-access.feature
 */

import {
  ProjectsApiService,
  type Project,
} from "@/client-sdk/services/projects/projects-api.service";
import type { GovernanceConfig } from "./governance/config";

/**
 * A `--project` value the CLI could not turn into a project it may use.
 *
 * `code` is the contract; the message is copy. `project_not_accessible` covers
 * both shapes of that answer — a name nothing matches, and a name the login
 * key is not allowed to see — because the platform answers them identically:
 * a credential that cannot view a project does not get it in the listing.
 * `project_lookup_failed` is the different case, where the listing itself did
 * not come back and we know nothing about the project either way.
 * `project_scope_not_supported` is the third: the project was named fine, but
 * the credential in hand carries its own project and cannot be pointed at
 * another, so honouring the name is not something a lookup could fix.
 */
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
const listAccessibleProjects = async (
  service: ProjectsApiService,
): Promise<Project[]> => {
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

/**
 * Resolve a `--project` value to a project id.
 *
 * The stored personal project answers without a round trip, since it is the
 * one project the CLI already knows by both id and slug. Everything else goes
 * through the listing, matching on id FIRST: ids and slugs live in one
 * namespace here, and an id is the exact reference, so a slug that happens to
 * read like another project's id can never steal the request.
 *
 * Throws `ProjectScopeError` rather than exiting, so the caller decides how to
 * render it (prose or the structured document) and the resolution stays
 * testable on its own.
 */
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
 * Where the key in hand came from, which decides what to tell someone whose
 * key cannot be pointed at the project they named. `--api-key` and
 * `LANGWATCH_API_KEY` are two sources, not one: the way out of the first is to
 * drop the flag, and telling that user to unset a variable they never set
 * points them at a key that is not the one answering.
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
 * The refusal for a project named against a key that carries its own project.
 *
 * A legacy project key (`sk-lw-` with no lookup id) encodes its project in the
 * token, so the server reads the project off the key and ignores any the
 * request names. Running anyway answers from the key's own project, which is
 * the silence this replaces: the rows come back, they are from somewhere else,
 * and nothing on screen says so.
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
