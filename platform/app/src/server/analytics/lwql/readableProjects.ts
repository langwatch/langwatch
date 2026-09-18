/**
 * LangWatchQL — the set of projects one API key may read (#8085).
 *
 * A LangWatchQL query runs across the union of the projects the caller's key can
 * read `analytics:view` on: a single-project credential reaches exactly its own
 * project; an API key reaches every project in its organization it holds the
 * permission on, `key ∩ user`. Each resolved project carries its `lwqlKey`, so
 * the caller becomes the tenant-capability SET the row policy resolves
 * (`./capability.ts`, `./provisioning/accessModel.ts`).
 *
 * The candidate list is enumerated HERE, from the organization, and never taken
 * from the request: a caller that could name the projects to read could name
 * one it may not. The per-project `analytics:view` verdict is injected as
 * `viewableCut`, so this module composes the permission cut the rest of the API
 * uses (`key ∩ user` at the project's scope) without depending on the app layer,
 * and the selection stays pure and testable.
 *
 * Empty is a valid scope, never an error: a key that can read nothing resolves
 * to no projects, which derives the empty capability and reads zero rows.
 *
 * @see ./capability.ts — the tenant capability set these projects become
 * @see specs/lwql/api.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as defaultPrisma } from "~/server/db";

/** A project the caller might read, as enumerated from its organization. */
export interface LwqlProjectCandidate {
  readonly id: string;
  /** The project's LangWatchQL secret (`Project.lwqlKey`). Never logged. */
  readonly lwqlKey: string;
  readonly teamId: string;
}

/** A project the caller may read, in the shape the service's caller set needs. */
export interface LwqlReadableProject {
  readonly id: string;
  /** The project's LangWatchQL secret (`Project.lwqlKey`). Never logged. */
  readonly lwqlKey: string;
}

/**
 * The `analytics:view` verdict for a batch of candidate projects, decided as
 * `key ∩ owning user` at each project's scope — exactly what every other REST
 * door asks. Injected so this module composes it rather than importing the app
 * layer, and so the selection above stays a pure function of the verdict.
 *
 * A batch by contract: called once with every candidate, so the grant snapshot
 * behind the decisions is collected once rather than once per project.
 */
export type LwqlViewableCut = (input: {
  candidates: readonly LwqlProjectCandidate[];
}) => Promise<(projectId: string) => boolean>;

/**
 * Selects the projects a caller may read from the candidates and a per-project
 * `analytics:view` verdict. Pure: the whole of the scoping decision, given the
 * verdict, and never widens beyond a project the verdict admits.
 *
 * An absent verdict denies: a project the cut did not answer for is excluded
 * rather than assumed, so a short answer can only narrow the scope.
 */
export function selectReadableLwqlProjects({
  candidates,
  canView,
}: {
  candidates: readonly LwqlProjectCandidate[];
  canView: (projectId: string) => boolean;
}): LwqlReadableProject[] {
  return candidates
    .filter((candidate) => canView(candidate.id))
    .map((candidate) => ({ id: candidate.id, lwqlKey: candidate.lwqlKey }));
}

/**
 * How the caller's credential names the projects it may read.
 *
 * A `project` credential (a legacy project key, or any credential already bound
 * to one project) IS that project — no RBAC fan-out, and no other project is
 * reachable. An `apiKey` credential fans out across its organization, gated by
 * the injected verdict.
 */
export type LwqlCallerCredential =
  | { readonly kind: "project"; readonly project: LwqlReadableProject }
  | {
      readonly kind: "apiKey";
      readonly organizationId: string;
    };

/**
 * The projects a LangWatchQL caller may read, resolved from its credential.
 *
 * Never throws on an empty result: a key with no readable project is a valid
 * (zero-row) scope, not a failure. The gateway decides separately whether to
 * refuse a caller that can read nothing — this only reports what it can read.
 */
export async function resolveLwqlReadableProjects({
  credential,
  viewableCut,
  prisma = defaultPrisma,
}: {
  credential: LwqlCallerCredential;
  viewableCut: LwqlViewableCut;
  prisma?: PrismaClient;
}): Promise<LwqlReadableProject[]> {
  if (credential.kind === "project") {
    return [credential.project];
  }

  const candidates = await prisma.project.findMany({
    where: {
      team: { organizationId: credential.organizationId },
      archivedAt: null,
      kind: { not: "internal_governance" },
    },
    select: { id: true, lwqlKey: true, teamId: true },
  });
  if (candidates.length === 0) return [];

  const canView = await viewableCut({ candidates });
  return selectReadableLwqlProjects({ candidates, canView });
}
