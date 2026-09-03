import type { SsoBreakGlassBindingRepository } from "../sso-connection.repository";
import { LOCAL_METHOD_SET } from "../services/signin-method-policy.service";

/**
 * Activation's break-glass precondition, before break-glass BINDINGS exist.
 *
 * D05 owns bindings: named people who keep a local way in while an
 * organization's sign-in belongs to an IdP, with expiry and 14/7/1-day
 * warnings. None of that exists yet, and ADR-117 §5 still makes a live
 * binding a condition of activation — because the failure it prevents is the
 * one that cannot be recovered from inside the product: a misconfigured
 * connection goes ACTIVE, every member is redirected to an IdP that will not
 * authenticate them, and nobody left can turn it off.
 *
 * So the requirement ships now with the weakest honest answer to it: does
 * this deployment still hold a local door at all? On an instance whose method
 * policy has no local methods, activation is refused — that is the lockout
 * case, and refusing it is the whole point. On one that does, the door exists
 * and activation proceeds, which is exactly today's behavior.
 *
 * This is deliberately a PORT rather than an inline check, and every
 * activation already calls it. When D05 lands, the bindings become this
 * port's answer and no guard, command or test has to change to start
 * enforcing them.
 */
export class LocalDoorBreakGlassBinding implements SsoBreakGlassBindingRepository {
  constructor(
    /** The instance's local method set. Injected so a test can express an
     *  instance with no local door without reaching for env. */
    private readonly localMethods: () => readonly unknown[] = () => LOCAL_METHOD_SET,
  ) {}

  async hasLiveBinding(_args: { organizationId: string }): Promise<boolean> {
    return this.localMethods().length > 0;
  }
}
