/**
 * The checking service, composed per call for the permission seams in
 * `rbac.ts` and `role-binding-resolver.ts`.
 *
 * Deliberately NOT composed in runtime.ts. The legacy vocabulary module
 * (`~/server/api/rbac`) is imported by client code for its role-group enums,
 * so anything it pulls at module scope lands in the browser bundle and in
 * every jsdom test graph — and the composition root imports prisma, redis and
 * the EE audit writer. Composing here from the caller's own Prisma handle
 * keeps that graph server-side. The services are stateless, so an instance
 * per call costs three allocations and shares nothing.
 *
 * The narrower rule: nothing here may import the app-wide prisma client
 * (`~/server/db`) or redis at module scope. A repository class over a handle
 * the caller already holds carries no such state. The boundary is enforced as
 * a graph by `src/server/__tests__/frontend-boundary.unit.test.ts`.
 */
import { AuthzCollectorService, AuthzService } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { demoProjectId } from "./demo-project";
import { CutoverAwareAuthzReadRepository } from "./repositories/authz-read.cutover.repository";

export function authzChecksFor(prisma: PrismaClient): AuthzService {
  return new AuthzService(
    // The per-organization repository the composition root also collects
    // through: an organization the engine is answering for reads from the
    // grants head, which is what finishing the migration switched it to.
    new AuthzCollectorService(new CutoverAwareAuthzReadRepository(prisma)),
    { demoProjectId },
  );
}
