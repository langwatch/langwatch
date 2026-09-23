import { LOCAL_METHOD_SET } from "@langwatch/identity-contract";

import type { SsoBreakGlassBindingRepository } from "../repositories/sso-connection.repository.ts";

/**
 * Activation's break-glass precondition, before break-glass BINDINGS exist.
 * warnings. None of that exists yet, and ADR-117 §5 still makes a live
 */
export class LocalDoorBreakGlassBindingAdapter implements SsoBreakGlassBindingRepository {
  static create(options?: {
    localMethods?: () => readonly unknown[];
  }): LocalDoorBreakGlassBindingAdapter {
    return new LocalDoorBreakGlassBindingAdapter(options?.localMethods ?? (() => LOCAL_METHOD_SET));
  }

  constructor(
    /** The instance's local method set. Injected so a test can express an
     *  instance with no local door without reaching for env. */
    private readonly localMethods: () => readonly unknown[] = () => LOCAL_METHOD_SET,
  ) {}

  async hasLiveBinding(_args: { organizationId: string }): Promise<boolean> {
    return this.localMethods().length > 0;
  }

  /** The local door has nothing to reserve: it is open or it is not. */
  async reserveActivationRecovery(args: { organizationId: string }): Promise<boolean> {
    return this.hasLiveBinding(args);
  }
}
