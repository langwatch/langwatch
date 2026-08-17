/**
 * ADR-092 delivery-plan PR 3 — fork composition for the seams a cut-over
 * organization is served from.
 *
 * Deliberately NOT composed in runtime.ts, for the reason ./shadow.ts spells
 * out at length: the legacy vocabulary module (`~/server/api/rbac`) is
 * imported by client code for its role-group enums, so anything it pulls at
 * module scope lands in the browser bundle and in every jsdom test graph. The
 * composition root imports prisma, redis and the EE audit writer — all
 * server-only. The fork instead composes per call from the caller's own Prisma
 * handle, exactly like the legacy checks it replaces; the services are
 * stateless, so a fresh instance per call costs three allocations and shares
 * nothing.
 *
 * The narrower rule this file obeys, again as in ./shadow.ts: nothing here may
 * import the app-wide prisma client (`~/server/db`) or redis AT MODULE SCOPE,
 * because that is the state whose module-load side effects reach the browser. A
 * repository CLASS constructed over a handle the caller already holds carries
 * no such state, so CutoverAwareAuthzReadRepository — and the two repositories
 * and the cutover gate it composes — is fine. The boundary is enforced as a
 * graph, not by review: src/server/__tests__/frontend-boundary.unit.test.ts.
 *
 * `demoProjectId` is imported from ./shadow rather than duplicated: it is the
 * same dynamic env read isDemoProject() performs, and both comparison
 * directions must agree about the demo project or every demo check reads as a
 * divergence.
 */
import {
  AuthzCollectorService,
  AuthzForkService,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { CutoverAwareAuthzReadRepository } from "./repositories/authz-read.cutover.repository";
import { demoProjectId } from "./shadow";

export function authzForkFor(prisma: PrismaClient): AuthzForkService {
  return new AuthzForkService(
    // The same per-organization repository the composition root collects
    // through. For an organization the fork is serving, the gate has already
    // answered "on engine", so this decorator resolves to the grants head —
    // the head that organization is now served from, which is the whole point
    // of the cutover.
    new AuthzCollectorService(new CutoverAwareAuthzReadRepository(prisma)),
    { demoProjectId },
  );
}
