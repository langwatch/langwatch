import { breakGlassIsLive } from "@langwatch/identity-contract";

import type { SsoBreakGlassRepository } from "../repositories/sso-break-glass.repository.ts";
import type { SsoBreakGlassBindingRepository } from "../repositories/sso-connection.repository.ts";

/**
 * Activation's and resume's second precondition, asked of the bindings
 * themselves: a live way back in for the organization, held for the one
 * activation so a concurrent revocation cannot remove it underneath.
 */
export class SsoBreakGlassRecoveryService implements SsoBreakGlassBindingRepository {
  static create(deps: {
    bindings: SsoBreakGlassRepository;
    now?: () => number;
  }): SsoBreakGlassRecoveryService {
    return new SsoBreakGlassRecoveryService(deps.bindings, deps.now ?? Date.now);
  }

  private constructor(
    private readonly bindings: SsoBreakGlassRepository,
    private readonly now: () => number,
  ) {}

  async hasLiveBinding({ organizationId }: { organizationId: string }): Promise<boolean> {
    const nowMs = this.now();
    const held = await this.bindings.findAllForOrganization({ organizationId });
    return held.some((binding) => breakGlassIsLive({ binding, nowMs }));
  }

  reserveActivationRecovery(args: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    return this.bindings.reserveActivationRecovery(args);
  }
}
