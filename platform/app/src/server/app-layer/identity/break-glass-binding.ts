import type { SsoBreakGlassBindingRepository } from "@langwatch/identity-server";
import { LOCAL_METHOD_SET } from "./signin-method-policy";

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
export class LocalDoorBreakGlassBinding
  implements SsoBreakGlassBindingRepository
{
  constructor(
    /** The instance's local method set. Injected so a test can express an
     *  instance with no local door without reaching for env. */
    private readonly localMethods: () => readonly unknown[] = () =>
      LOCAL_METHOD_SET,
  ) {}

  async hasLiveBinding(_args: { organizationId: string }): Promise<boolean> {
    return this.localMethods().length > 0;
  }
}

/**
 * Activation's break-glass precondition as of D05: a named person who holds
 * a live binding, AND a local door for that binding to be a way in through.
 *
 * Both, because they answer different halves of one question. A binding on
 * an installation whose method policy mounts no local method names somebody
 * who cannot actually sign in — it is a promise the deployment cannot keep.
 * A local door with nobody named is the answer D04 shipped with, and the one
 * D05 exists to replace: "somebody could sign in with a password if they had
 * one" is not the same as "this person can get in on Monday".
 *
 * Requiring both means the two rollouts compose rather than fight: an
 * installation that has not granted a binding yet is refused activation and
 * told why, which is exactly the outcome the spec asks for.
 */
export class RequiresLocalDoorAndBinding
  implements SsoBreakGlassBindingRepository
{
  constructor(
    private readonly deps: {
      localDoor: SsoBreakGlassBindingRepository;
      bindings: SsoBreakGlassBindingRepository;
    },
  ) {}

  async hasLiveBinding(args: { organizationId: string }): Promise<boolean> {
    if (!(await this.deps.localDoor.hasLiveBinding(args))) return false;
    return this.deps.bindings.hasLiveBinding(args);
  }
}
