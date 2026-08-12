/**
 * ADR-092 stage A4 — shadow composition for the legacy resolvers.
 *
 * Deliberately NOT composed in runtime.ts: the legacy vocabulary module
 * (`~/server/api/rbac`) is imported by client code for its role-group
 * enums, so anything it pulls at module scope lands in the browser bundle
 * and in every jsdom test graph. The composition root imports prisma,
 * redis and the EE audit writer — all server-only — and its graph loops
 * back into rbac.ts through `~/utils/constants`. The shadow instead
 * composes per call from the caller's own Prisma handle, exactly like the
 * legacy checks it mirrors; the services are stateless, so a fresh
 * instance per call costs three allocations and shares nothing.
 */
import {
  AuthzCollectorService,
  AuthzShadowService,
} from "@langwatch/authz-server";
import type { PrismaClient } from "@prisma/client";
import { PrismaAuthzReadRepository } from "./repositories/authz-read.prisma.repository";

export function authzShadowFor(prisma: PrismaClient): AuthzShadowService {
  return new AuthzShadowService(
    new AuthzCollectorService(new PrismaAuthzReadRepository(prisma)),
  );
}
