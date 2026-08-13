/**
 * ADR-092 stage A4 — shadow composition for the legacy resolvers.
 *
 * Deliberately NOT composed in runtime.ts: the legacy vocabulary module
 * (`~/server/api/rbac`) is imported by client code for its role-group
 * enums, so anything it pulls at module scope lands in the browser bundle
 * and in every jsdom test graph. The composition root imports prisma, redis
 * and the EE audit writer — all server-only. The shadow instead composes per
 * call from the caller's own Prisma handle, exactly like the legacy checks it
 * mirrors; the services are stateless, so a fresh instance per call costs
 * three allocations and shares nothing.
 *
 * The rule that follows is narrower than "no storage", and this module does
 * construct a repository: nothing here may import the app-wide prisma client
 * (`~/server/db`) or redis AT MODULE SCOPE, because that is the state whose
 * module-load side effects reach the browser. A repository CLASS constructed
 * over a handle the caller already holds carries no such state, so
 * PrismaAuthzReadRepository below is fine. The boundary is enforced as a
 * graph, not by review: src/server/__tests__/frontend-boundary.unit.test.ts.
 *
 * The two env reads below are the whole of what it needs, and both are
 * functions the shadow service calls per check — runtime.ts imports
 * `demoProjectId` from HERE rather than the reverse, because that is the
 * direction the boundary allows.
 */
import {
  AuthzCollectorService,
  AuthzShadowService,
} from "@langwatch/authz-server";
import type { PrismaClient } from "@prisma/client";
import { PrismaAuthzReadRepository } from "./repositories/authz-read.prisma.repository";

/**
 * `AUTHZ_V2_SHADOW` as a sample rate: "1"/"true" compares every check, a
 * fraction compares that share of them, and anything else — unset, "0",
 * "off", a malformed number — is off. Read per check so the knob can move
 * without a restart; nothing here can affect a response, so the failure
 * direction of a bad value is simply no comparison.
 */
export function parseShadowRate(): number {
  const raw = process.env.AUTHZ_V2_SHADOW;
  if (!raw) return 0;
  if (raw === "1" || raw === "true") return 1;
  // Number(), not parseFloat(): parseFloat("1oops") is 1, which would read a
  // typo as "compare every check". Number() rejects the whole string, and
  // Number.isFinite also turns "Infinity" away.
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * The demo project, read dynamically to match `isDemoProject()` in rbac.ts —
 * tests set it after module load, so capturing it once would answer the wrong
 * question.
 */
export function demoProjectId(): string | undefined {
  return process.env.DEMO_PROJECT_ID ?? undefined;
}

export function authzShadowFor(prisma: PrismaClient): AuthzShadowService {
  return new AuthzShadowService(
    new AuthzCollectorService(new PrismaAuthzReadRepository(prisma)),
    { sampleRate: parseShadowRate, demoProjectId },
  );
}
