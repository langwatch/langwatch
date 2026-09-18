import { createLogger } from "@langwatch/observability";

import type { NurturingProfileRepository } from "../repositories/nurturing-profile.repository.ts";
import type { NurturingService } from "../services/nurturing.service.ts";

/**
 * What the lifecycle-signal services reach for, and why it is registered rather than passed.
 * Every one of these signals is FIRE-AND-FORGET: a prompt written, a member invited, a session
 * seen.
 */
const nurturingLogger = createLogger("langwatch:billing:nurturing");

/** Resolves an organization admin for a project, when no actor is in hand. */
export type OrganizationAdminResolver = (
  projectId: string,
) => Promise<{ userId: string; organizationId: string } | null>;

let sink: NurturingService | null = null;
let profiles: NurturingProfileRepository | null = null;
let organizationAdminResolver: OrganizationAdminResolver | null = null;

/** Registers the process's Customer.io sink. Called once, at composition. */
export function setSink(nextSink: NurturingService | null): void {
  sink = nextSink;
}

/** The registered sink, or null when this process composed none. */
export function findSink(): NurturingService | null {
  return sink;
}

/**
 * Registers the reads two of these signals make on their own — the member
 * list behind a subscription sync, and the person behind a session. Both are
 * plain row reads; the process supplies the repository they run on.
 */
export function setProfiles(nextProfiles: NurturingProfileRepository | null): void {
  profiles = nextProfiles;
}

/** The registered reader, or null when this process composed none. */
export function findProfiles(): NurturingProfileRepository | null {
  return profiles;
}

/** Registers how an organization admin is resolved for a project. */
export function setOrganizationAdminResolver(resolve: OrganizationAdminResolver | null): void {
  organizationAdminResolver = resolve;
}

/** The registered resolver, or null when this process composed none. */
export function findOrganizationAdminResolver(): OrganizationAdminResolver | null {
  return organizationAdminResolver;
}

/**
 * Where a fire-and-forget lifecycle signal's failure goes. Warn rather than error, and
 * swallowed rather than rethrown: the caller has already done the thing the customer asked
 * for, and a Customer.io outage is not the customer's problem.
 */
export function reportFailure(error: unknown): void {
  nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
}
