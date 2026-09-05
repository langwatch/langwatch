import type { SsoPlatformOperatorRepository } from "@langwatch/identity-server";
import { isAdmin } from "../../../../ee/admin/isAdmin";

/**
 * The one fact the operator list needs about a person: the address on their
 * `User` head. `PrismaIdentityUsersRepository` already answers it.
 */
export interface PlatformOperatorAddressPort {
  findEmail(args: { userId: string }): Promise<string | null>;
}

/**
 * Who counts as a LangWatch platform operator, for the guards that refuse an
 * organization administrator's hand (D05 tier 1).
 *
 * The answer is `ADMIN_EMAILS`, which is what already decides who reaches the
 * back office at all — deliberately, and not `ops:*`. `ops` is the permission
 * registry's only platform-scope resource, and if it ever widens to a broader
 * operator population, "who may attest a customer's domain" must not widen
 * with it silently. Reusing the existing answer means these commands are
 * reachable by exactly the people who can already reach the surface that
 * issues them, and one place decides that.
 *
 * It reads the actor's address from the `User` head rather than trusting one
 * off the command: an actor id is what a command carries, and an address is
 * what the deployment's operator list is written in. Resolving the two here,
 * once, keeps every caller from having to.
 */
export class AdminEmailPlatformOperators
  implements SsoPlatformOperatorRepository
{
  constructor(private readonly users: PlatformOperatorAddressPort) {}

  async isPlatformOperator({ actorId }: { actorId: string }): Promise<boolean> {
    const email = await this.users.findEmail({ userId: actorId });
    return isAdmin({ email });
  }
}

/**
 * The answer when there is no person to ask about — the grandfather
 * migration's system actor, and any other caller that is the platform itself.
 *
 * A separate class rather than a flag on the one above because "the platform
 * is acting" and "this person is an operator" are different questions, and a
 * boolean that collapsed them would be one refactor away from letting a
 * request supply its own answer.
 */
export class SystemActorPlatformOperators
  implements SsoPlatformOperatorRepository
{
  async isPlatformOperator(_args: { actorId: string }): Promise<boolean> {
    return true;
  }
}
