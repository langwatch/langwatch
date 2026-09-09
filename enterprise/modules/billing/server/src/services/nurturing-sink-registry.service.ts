import { createLogger } from "@langwatch/observability";
import type { NurturingProfileRepository } from "../repositories/nurturing-profile.repository.ts";
import type { NurturingService } from "./nurturing.service.ts";

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

export class NurturingSinkRegistryService {
  static #sink: NurturingService | null = null;
  static #profiles: NurturingProfileRepository | null = null;
  static #organizationAdminResolver: OrganizationAdminResolver | null = null;

  static create(): NurturingSinkRegistryService {
    return new NurturingSinkRegistryService();
  }

  private constructor() {}

  /** Registers the process's Customer.io sink. Called once, at composition. */
  static setSink(sink: NurturingService | null): void {
    NurturingSinkRegistryService.#sink = sink;
  }

  /** The registered sink, or null when this process composed none. */
  static trySink(): NurturingService | null {
    return NurturingSinkRegistryService.#sink;
  }

  /**
   * Registers the reads two of these signals make on their own — the member
   * list behind a subscription sync, and the person behind a session. Both are
   * plain row reads; the process supplies the repository they run on.
   */
  static setProfiles(profiles: NurturingProfileRepository | null): void {
    NurturingSinkRegistryService.#profiles = profiles;
  }

  /** The registered reader, or null when this process composed none. */
  static tryProfiles(): NurturingProfileRepository | null {
    return NurturingSinkRegistryService.#profiles;
  }

  /** Registers how an organization admin is resolved for a project. */
  static setOrganizationAdminResolver(resolve: OrganizationAdminResolver | null): void {
    NurturingSinkRegistryService.#organizationAdminResolver = resolve;
  }

  /** The registered resolver, or null when this process composed none. */
  static tryOrganizationAdminResolver(): OrganizationAdminResolver | null {
    return NurturingSinkRegistryService.#organizationAdminResolver;
  }

  /**
   * Where a fire-and-forget lifecycle signal's failure goes. Warn rather than error, and
   * swallowed rather than rethrown: the caller has already done the thing the customer asked
   * for, and a Customer.io outage is not the customer's problem.
   */
  static reportFailure(error: unknown): void {
    nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
  }
}
