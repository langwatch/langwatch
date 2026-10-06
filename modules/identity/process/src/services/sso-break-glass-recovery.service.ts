import { breakGlassIsLive } from "@langwatch/identity-contract";

import type { SsoBreakGlassRepository } from "../repositories/sso-break-glass.repository.ts";
import type { SsoBreakGlassBindingRepository } from "../repositories/sso-connection.repository.ts";

/**
 * Activation's and resume's second precondition: a live way back in whose
 * holder could walk it (an administrator holding a password), held for the one
 * activation. A binding alone is not enough: it can name somebody with no key.
 */
export class SsoBreakGlassRecoveryService implements SsoBreakGlassBindingRepository {
  static create(deps: {
    bindings: SsoBreakGlassRepository;
    holderCanWalkIn: (args: { organizationId: string; userId: string }) => Promise<boolean>;
    now?: () => number;
  }): SsoBreakGlassRecoveryService {
    return new SsoBreakGlassRecoveryService(
      deps.bindings,
      deps.holderCanWalkIn,
      deps.now ?? Date.now,
    );
  }

  private constructor(
    private readonly bindings: SsoBreakGlassRepository,
    private readonly holderCanWalkIn: (args: {
      organizationId: string;
      userId: string;
    }) => Promise<boolean>,
    private readonly now: () => number,
  ) {}

  async hasLiveBinding({ organizationId }: { organizationId: string }): Promise<boolean> {
    const nowMs = this.now();
    const held = await this.bindings.findAllForOrganization({ organizationId });
    for (const binding of held) {
      if (!breakGlassIsLive({ binding, nowMs })) continue;
      if (await this.holderCanWalkIn({ organizationId, userId: binding.userId })) return true;
    }
    return false;
  }

  async reserveActivationRecovery(args: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    if (!(await this.hasLiveBinding(args))) return false;
    return this.bindings.reserveActivationRecovery(args);
  }
}
