import type { SsoBreakGlassBindingRepository } from "../repositories/sso-connection.repository";
import { LOCAL_METHOD_SET } from "../services/signin-method-policy.service";

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
}
