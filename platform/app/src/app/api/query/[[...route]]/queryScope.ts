/**
 * The query door's scope resolution (#8085).
 *
 * Turns an authenticated {@link KeyPrincipal} into the two things both doors
 * hand the service: the projects the key may read, and the content protections
 * to redact by. It is the whole of the door's authorization, kept out of the
 * handler so it can be exercised without a mounted app or a database — every
 * dependency (the RBAC decision, the candidate enumeration, the per-project
 * protections) is injected.
 *
 *  - A project key IS its own project; no fan-out.
 *  - An API key fans out across its organization, gated per project by the
 *    `analytics:view` decision (`key ∩ owning user`), decided in ONE batch.
 *  - A key that reads no project resolves to an empty scope, never a refusal:
 *    the service reads zero rows for it. The gate does not 403 a permissionless
 *    key — the row policy, not the door, is the tenant boundary.
 *
 * Content gating is strictest-wins: LangWatchQL's own gate primitive
 * (`heldGates`) reads only the three captured-content / cost flags, so the
 * complete intersection across the readable set is the logical AND of those
 * three — a category is offered only when every readable project grants it.
 *
 * @see ~/server/analytics/lwql/readableProjects — the pure selection this wires
 * @see specs/lwql/api.feature
 */

import type { AuthzPermission } from "@langwatch/authz";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  type LwqlCallerCredential,
  type LwqlReadableProject,
  type LwqlViewableCut,
  resolveLwqlReadableProjects,
} from "~/server/analytics/lwql/readableProjects";
import { getProtectionsForProject } from "~/server/api/utils";
import type { KeyPrincipal } from "~/server/api-key/auth-middleware";
import type { App } from "~/server/app-layer/app";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/traces/protections";

const QUERY_PERMISSION: AuthzPermission = "analytics:view";

/**
 * The batched `analytics:view` decision the fan-out needs, typed off the real
 * permissions service so it is assignable and a test can fake just this one
 * method.
 */
export type ProjectCutsProvider = Pick<App["permissions"], "apiKeyProjectCuts">;

/**
 * The projects a query may read and the protections to redact its content by,
 * both derived from the authenticated principal.
 */
export interface LwqlQueryScope {
  readonly projects: LwqlReadableProject[];
  readonly protections: Protections;
}

/**
 * The strictest protections across a readable set — a content category is
 * offered only when EVERY project in the set grants it. An empty set offers
 * nothing (fail-closed), which is right for both doors: the query reads zero
 * rows, and the schema shows nothing available.
 */
export function strictestLwqlProtections(
  perProject: readonly Protections[],
): Protections {
  if (perProject.length === 0) {
    return {
      canSeeCosts: false,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
    };
  }
  return {
    canSeeCosts: perProject.every((p) => p.canSeeCosts === true),
    canSeeCapturedInput: perProject.every(
      (p) => p.canSeeCapturedInput === true,
    ),
    canSeeCapturedOutput: perProject.every(
      (p) => p.canSeeCapturedOutput === true,
    ),
  };
}

/** The `analytics:view` verdict for the candidate projects, in one batch. */
function apiKeyViewableCut({
  permissions,
  apiKeyId,
  userId,
  organizationId,
}: {
  permissions: ProjectCutsProvider;
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
}): LwqlViewableCut {
  return async ({ candidates }) => {
    const cuts = await permissions.apiKeyProjectCuts({
      apiKeyId,
      userId,
      organizationId,
      projects: candidates.map((candidate) => ({
        projectId: candidate.id,
        teamId: candidate.teamId,
      })),
      permissions: [QUERY_PERMISSION],
    });
    const byProject = cuts.get(QUERY_PERMISSION);
    return (projectId: string) => byProject?.get(projectId) === true;
  };
}

/**
 * Resolve the projects a caller may read and the protections to redact by.
 *
 * `permissions` and `protectionsFor` are injected so this is unit-testable
 * without a mounted app or database; the handler passes the request's own App
 * and the default per-project protections loader.
 */
export async function resolveLwqlQueryScope({
  principal,
  permissions,
  prisma = defaultPrisma,
  protectionsFor = (projectId: string) =>
    getProtectionsForProject(prisma, { projectId }),
}: {
  principal: KeyPrincipal;
  permissions: ProjectCutsProvider;
  prisma?: PrismaClient;
  protectionsFor?: (projectId: string) => Promise<Protections>;
}): Promise<LwqlQueryScope> {
  const credential: LwqlCallerCredential =
    principal.kind === "project"
      ? {
          kind: "project",
          project: {
            id: principal.project.id,
            lwqlKey: principal.project.lwqlKey,
          },
        }
      : { kind: "apiKey", organizationId: principal.organizationId };

  // Only an API key fans out; a project key never calls the cut.
  const viewableCut: LwqlViewableCut =
    principal.kind === "apiKey"
      ? apiKeyViewableCut({
          permissions,
          apiKeyId: principal.apiKeyId,
          userId: principal.userId,
          organizationId: principal.organizationId,
        })
      : async () => () => false;

  const projects = await resolveLwqlReadableProjects({
    credential,
    viewableCut,
    prisma,
  });

  const protections = strictestLwqlProtections(
    await Promise.all(projects.map((project) => protectionsFor(project.id))),
  );

  return { projects, protections };
}
