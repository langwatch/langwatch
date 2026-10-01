/**
 * Who may reach an `ops.*` procedure. The surface is PLATFORM-TIER -
 * `withPermission` needs a scope id these procedures carry none of, so
 * `serviceAuthorized` defers to the deployment's operator allow-list.
 */
import { defineTrpcFact } from "@langwatch/api/trpc";
import { opsOperatorSchema } from "@langwatch/ops-contract";

/**
 * The signed-in person behind the request, including the impersonator where
 * one is present. A fact rather than part of the actor: the allow-list is a
 * list of addresses, and an actor carries only an id.
 */
export const opsOperatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

/** Why the operator gate is the handler's rather than the door's. */
const PLATFORM_TIER =
  "the operator surface reads and acts across every tenant, so there is no scope an id in " +
  "the input could be checked at; what decides it is the deployment's own operator " +
  "allow-list, resolved by the application in the handler, and an impersonating operator " +
  "is read as the operator";

/** Every read on the operator surface. */
export const OPS_VIEW = {
  reason: PLATFORM_TIER,
  permissions: ["ops:view"],
} as const;

/**
 * Every write. The ones whose damage nobody would notice in time additionally
 * require a non-impersonated session and a typed confirmation, which the
 * application asks for.
 */
export const OPS_MANAGE = {
  reason: PLATFORM_TIER,
  permissions: ["ops:manage"],
} as const;

/**
 * The status probe. Answers `{ kind: "none" }` for a non-operator rather
 * than refusing, so the global menu can poll it every page load without
 * spamming the console (lw#3584); it discloses only whether the caller is staff.
 */
export const OPS_PROBE = {
  reason:
    "the probe reads the caller's OWN operator reach and answers it, so refusing a " +
    "non-operator would be refusing to say no",
} as const;

/**
 * The support inbox. Same allow-list, still not an RBAC grain: a bug report
 * carries no tenant - no organization, team or project column - so there is
 * no scope an id could be checked at, and no role that could grant the read.
 */
export const BUG_REPORTS_STAFF_ONLY = {
  reason:
    "a bug report carries no tenant, so there is no scope an id in the input could be " +
    "checked at and no organization role that could grant the read; what decides it is the " +
    "LangWatch staff list, checked by the application in the handler",
} as const;
