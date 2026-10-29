import {
  LangWatchQLProjectNotFoundError,
  LangWatchQLProjectsRequiredError,
  type LangWatchQLCaller,
  type LangWatchQLKeyReach,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { LWQL_MAX_MEMBER_PROJECTS } from "@langwatch/analytics-contract/langwatch-ql-limits";
/**
 * The query door's scope: the projects an API key may read and the protections to redact by.
 * The candidates are enumerated from the key's organization, never taken from the request, and
 * a key that reads nothing is a valid empty scope — the row policy, not the door, is the boundary.
 */
import type { Authorization, RestProjectCredentialPrincipal } from "@langwatch/authorization";
import { ValidationError } from "@langwatch/handled-error";
import { PROJECT_KIND, type Project, type ProjectApi } from "@langwatch/project-contract";

import { inStableOrder } from "../rules/langwatch-ql-project-selection.rules.ts";
import { strictestLangWatchQLProtections } from "../rules/langwatch-ql-query-scope.rules.ts";
import { dedupeInOrder } from "../rules/langwatch-ql-run-params.rules.ts";
import { LWQL_TENANT_CAPABILITY_MAX_PROJECTS } from "./langwatch-ql-capability.service.ts";
import {
  WorkbenchProtectionsService,
  type WorkbenchProtectionsDependencies,
} from "./workbench-protections.service.ts";

/** The projects one query may read, and the protections its content is redacted by. */
export type LangWatchQLQueryScope = Readonly<{
  projects: readonly LangWatchQLCaller[];
  protections: LangWatchQLProtections;
}>;

type ScopeDependencies = WorkbenchProtectionsDependencies &
  Readonly<{ projects: Pick<ProjectApi, "findById" | "listByOrganization"> }>;

type ReadableProject = Readonly<{
  project: Pick<Project, "id" | "lwqlKey" | "teamId">;
  credential: RestProjectCredentialPrincipal;
}>;

/** How many of an organization's projects one scan page reads. */
const SCAN_PAGE_SIZE = 100;

export class LangWatchQLQueryScopeService {
  static create(dependencies: ScopeDependencies): LangWatchQLQueryScopeService {
    return new LangWatchQLQueryScopeService(dependencies);
  }

  private readonly protections: WorkbenchProtectionsService;

  private constructor(private readonly dependencies: ScopeDependencies) {
    this.protections = WorkbenchProtectionsService.create(dependencies);
  }

  /**
   * The readable set and the strictest protections across it. Named `projects` narrow the set
   * before any protection is read, and one the key cannot read refuses the whole run. With
   * `requireProjects`, a key for an organization, a team or a person must name them.
   * @throws {LangWatchQLProjectsRequiredError} when required and none are named.
   * @throws {LangWatchQLProjectNotFoundError} for any named project the key cannot read.
   */
  async resolve({
    reach,
    projects,
    requireProjects = false,
  }: {
    reach: LangWatchQLKeyReach;
    projects?: readonly string[];
    requireProjects?: boolean;
  }): Promise<LangWatchQLQueryScope> {
    const named = projects === undefined ? undefined : dedupeInOrder(projects);
    // A key that reads exactly one project defaults to it; one that reads several must say which.
    // Two readable projects settle that, so the scan stops there instead of reading the rest.
    const mustDefault = requireProjects && named === undefined && reach.kind !== "project";
    const readable =
      reach.kind === "project"
        ? [await this.ownProject({ projectId: reach.projectId, requested: named })]
        : await this.readableProjects({
            reach,
            only: named,
            stopAfter: mustDefault ? 2 : undefined,
          });
    if (mustDefault && readable.length === 0) throw new LangWatchQLProjectNotFoundError();
    if (mustDefault && readable.length > 1) throw new LangWatchQLProjectsRequiredError();
    // One project at a time: each answer is several grant reads, and fanning an organization's
    // worth out at once is what exhausts the connection pool.
    const protections: LangWatchQLProtections[] = [];
    for (const { project, credential } of readable) {
      protections.push(
        await this.protections.resolveApiKeyProtections({ projectId: project.id, credential }),
      );
    }

    return {
      projects: readable.map(({ project }) => ({ id: project.id, lwqlKey: project.lwqlKey })),
      protections: strictestLangWatchQLProtections(protections),
    };
  }

  /**
   * Every project the key reads, in id order, for `projects: "all"`. Each holds `analytics:view`
   * for the key, so a project it lacks, or of another organization, is never among them.
   * @throws {LangWatchQLProjectNotFoundError} when the key reads none, with no id.
   */
  async resolveAll({ reach }: { reach: LangWatchQLKeyReach }): Promise<LangWatchQLQueryScope> {
    const scope = await this.resolve({ reach });
    if (scope.projects.length === 0) throw new LangWatchQLProjectNotFoundError();

    return { ...scope, projects: inStableOrder(scope.projects) };
  }

  /**
   * The named projects, each proven readable by this key as a run would: a project key reads
   * its own project alone, an API key those it holds `analytics:view` on.
   * @throws {LangWatchQLProjectNotFoundError} for any that is not, with no id in the answer.
   */
  async assertReadableByKey({
    reach,
    projectIds,
  }: {
    reach: LangWatchQLKeyReach;
    projectIds: readonly string[];
  }): Promise<void> {
    const named = dedupeInOrder(projectIds);
    if (reach.kind === "project") {
      await this.ownProject({ projectId: reach.projectId, requested: named });
      return;
    }
    await this.readableProjects({ reach, only: named });
  }

  /**
   * The projects a signed-in member's card names and the strictest protections across them.
   * Each must exist and hold `analytics:view` for the member; any that does not refuses the
   * whole run with the one id-free answer, so a card never learns which of them was the cause.
   * @throws {LangWatchQLProjectNotFoundError} for a project missing, foreign or unreadable.
   */
  async resolveMemberProjects({
    userId,
    projectIds,
    alreadyAuthorized = false,
    authorization,
  }: {
    userId: string;
    projectIds: readonly string[];
    /** The ids come from the member's own readable list, so the grant is not asked again. */
    alreadyAuthorized?: boolean;
    authorization?: Authorization;
  }): Promise<LangWatchQLQueryScope> {
    const projects = await this.readableByMember({ userId, projectIds, alreadyAuthorized });
    const protections: LangWatchQLProtections[] = [];
    // One project at a time, for the same reason `resolve` reads protections one at a time.
    for (const { id: projectId } of projects) {
      protections.push(
        await this.protections.resolveMemberProtections({
          userId,
          projectId,
          ...(authorization ? { authorization } : {}),
        }),
      );
    }

    return { projects, protections: strictestLangWatchQLProtections(protections) };
  }

  /**
   * The named projects, each proven to exist and to hold `analytics:view` for the member.
   * @throws {LangWatchQLProjectNotFoundError} for any that does not, with no id in the answer.
   */
  async readableByMember({
    userId,
    projectIds,
    alreadyAuthorized = false,
  }: {
    userId: string;
    projectIds: readonly string[];
    alreadyAuthorized?: boolean;
  }): Promise<LangWatchQLCaller[]> {
    const ids = dedupeInOrder(projectIds);
    if (ids.length > LWQL_MAX_MEMBER_PROJECTS) {
      throw new ValidationError(`name at most ${LWQL_MAX_MEMBER_PROJECTS} projects`);
    }
    // Every id is looked up and checked, all at once, before any is judged, so the answer's
    // timing cannot tell a missing project from an unreadable one or place it in the list.
    const checked = await Promise.all(
      ids.map(async (projectId) => ({
        project: await this.dependencies.projects.findById(projectId),
        // An authz outage propagates (a 5xx), never a 404: only a denial reads as not found.
        allowed:
          alreadyAuthorized ||
          (await this.dependencies.authz.hasPermission({
            userId,
            permission: "analytics:view",
            projectId,
          })),
      })),
    );
    const readable: LangWatchQLCaller[] = [];
    for (const { project, allowed } of checked) {
      const live =
        project !== null &&
        project !== undefined &&
        project.archivedAt === null &&
        project.kind !== PROJECT_KIND.INTERNAL_GOVERNANCE;
      if (!live || !allowed) throw new LangWatchQLProjectNotFoundError();
      readable.push({ id: project.id, lwqlKey: project.lwqlKey });
    }

    return readable;
  }

  /**
   * Whether the key clears `analytics:view` at the project it resolved to, as main's reference
   * door asks: a legacy key always does, and a key that resolved no project never does.
   */
  async holdsQueryPermission({ reach }: { reach: LangWatchQLKeyReach }): Promise<boolean> {
    if (reach.kind === "project") return true;
    if (!reach.resolvedProject) return false;

    return this.protections.keyPermitted({
      credential: {
        kind: "apiKey",
        apiKeyId: reach.apiKeyId,
        userId: reach.userId,
        organizationId: reach.organizationId,
        projectId: reach.resolvedProject.id,
        teamId: reach.resolvedProject.teamId,
      },
      permission: "analytics:view",
    });
  }

  /** A legacy project key reaches exactly its own project, with no RBAC fan-out. */
  private async ownProject({
    projectId,
    requested,
  }: {
    projectId: string;
    requested?: readonly string[];
  }): Promise<ReadableProject> {
    if (requested?.some((id) => id !== projectId)) throw new LangWatchQLProjectNotFoundError();
    const project = await this.dependencies.projects.findById(projectId);
    if (!project) throw new LangWatchQLProjectNotFoundError();

    return { project, credential: { kind: "legacyProjectKey" } };
  }

  /**
   * Every live application project in the key's organization it holds `analytics:view` on,
   * decided as `key ∩ owning user` at each project's own scope. Read a page at a time; the cap
   * counts what the key READS, not what the organization has. `stopAfter` ends the scan early.
   */
  private async readableProjects({
    reach,
    only,
    stopAfter = Infinity,
  }: {
    reach: Extract<LangWatchQLKeyReach, { kind: "apiKey" }>;
    only?: readonly string[] | undefined;
    stopAfter?: number | undefined;
  }): Promise<ReadableProject[]> {
    const readable: ReadableProject[] = [];
    let scanned = 0;
    let total = Infinity;
    for (let page = 1; scanned < total; page += 1) {
      const listed = await this.dependencies.projects.listByOrganization({
        organizationId: reach.organizationId,
        page,
        limit: only === undefined ? SCAN_PAGE_SIZE : LWQL_TENANT_CAPABILITY_MAX_PROJECTS,
        ...(only === undefined ? {} : { projectIds: [...only] }),
      });
      readable.push(
        ...(await this.permitted({
          reach,
          projects: listed.data,
          room: stopAfter - readable.length,
        })),
      );
      assertWithinCap(readable.length);
      if (readable.length >= stopAfter || only !== undefined || listed.data.length === 0) break;
      scanned += listed.data.length;
      total = listed.pagination.total;
    }

    return only === undefined ? readable : inRequestOrder({ readable, only });
  }

  /** The first `room` of these projects the key holds `analytics:view` on, one at a time. */
  private async permitted({
    reach,
    projects,
    room,
  }: {
    reach: Extract<LangWatchQLKeyReach, { kind: "apiKey" }>;
    projects: readonly Project[];
    room: number;
  }): Promise<ReadableProject[]> {
    const found: ReadableProject[] = [];
    // One project at a time, for the pool reason `resolve` gives.
    for (const project of projects) {
      if (found.length >= room) break;
      if (project.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) continue;
      const credential = keyCredentialFor({ reach, project });
      if (await this.protections.keyPermitted({ credential, permission: "analytics:view" })) {
        found.push({ project, credential });
      }
    }

    return found;
  }
}

/** @throws {ValidationError} when the key reads more projects than one run may. */
function assertWithinCap(readCount: number): void {
  if (readCount <= LWQL_TENANT_CAPABILITY_MAX_PROJECTS) return;
  throw new ValidationError(
    `The key can read more than ${LWQL_TENANT_CAPABILITY_MAX_PROJECTS} projects, over the ` +
      `most a run may read. Name the projects instead.`,
  );
}

/** @throws {LangWatchQLProjectNotFoundError} when any named project is not among those read. */
function inRequestOrder({
  readable,
  only,
}: {
  readable: readonly ReadableProject[];
  only: readonly string[];
}): ReadableProject[] {
  const byId = new Map(readable.map((entry) => [entry.project.id, entry]));
  const ordered = only.flatMap((id) => byId.get(id) ?? []);
  if (ordered.length < only.length) throw new LangWatchQLProjectNotFoundError();

  return ordered;
}

/** The principal a key is judged as at one project's own scope. */
function keyCredentialFor({
  reach,
  project,
}: {
  reach: Extract<LangWatchQLKeyReach, { kind: "apiKey" }>;
  project: Pick<Project, "id" | "teamId">;
}): RestProjectCredentialPrincipal {
  return {
    kind: "apiKey",
    apiKeyId: reach.apiKeyId,
    userId: reach.userId,
    organizationId: reach.organizationId,
    projectId: project.id,
    teamId: project.teamId,
  };
}
