import type { Instant } from "@langwatch/time";

import type { AuthzEngineSwitch } from "../rules/authz-engine-switch.rules.ts";

/**
 * Authz's own engine switch: whether the engine answers an organization's permission checks, and
 * since when. Reads raise: the caching gate above decides what a failed read means for its caller.
 * Spec: modules/authz/specs/engine-switch.feature.
 */
export abstract class AuthzCutoverRepository {
  /** No row answers the legacy path; ops' older state row is read beside authz's own. */
  abstract getEngineSwitch(input: { organizationId: string }): Promise<AuthzEngineSwitch>;

  /**
   * Turns the engine on for an organization the migration proved, unless an operator pinned it
   * off, here or in ops' older row. Answers whether it is on now.
   */
  abstract switchOnEngine(input: { organizationId: string; at: Instant }): Promise<boolean>;

  /** An operator's rollback: off for good, keeping the fact's id as the row's version. */
  abstract pinEngineSwitch(input: {
    organizationId: string;
    at: Instant;
    eventId: string;
  }): Promise<void>;

  /** Copies ops' finished engine-migration rows into the switch where newer; answers a count. */
  abstract carryOverEngineSwitch(input: { dryRun: boolean }): Promise<number>;
}
