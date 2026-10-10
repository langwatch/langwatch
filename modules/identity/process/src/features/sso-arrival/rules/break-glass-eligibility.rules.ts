import type { SignInMethodPolicyResolver } from "@langwatch/identity-contract";

/**
 * Senior enough to be trusted with a door the organization does not otherwise
 * have, AND holding the key: an administrator who only ever signed in through
 * the identity provider holds no password, so naming them opens nothing.
 */
export function breakGlassHolderEligibility(deps: {
  isAdministrator: (args: { organizationId: string; userId: string }) => Promise<boolean>;
  holdsPassword: (args: { userId: string }) => Promise<boolean>;
}): (args: { organizationId: string; userId: string }) => Promise<boolean> {
  return async ({ organizationId, userId }) => {
    if (!(await deps.isAdministrator({ organizationId, userId }))) return false;

    return deps.holdsPassword({ userId });
  };
}

/**
 * Whether the deployment's resolved method policy hangs a password door at
 * all: on cloud a federated provider replaces it unless the instance also
 * issues its own passwords. A grant is a way in through this door or none.
 */
export function passwordDoorMounted(policy: SignInMethodPolicyResolver): () => Promise<boolean> {
  return async () =>
    (await policy.resolvePolicy()).defaultMethods.some((method) => method.kind === "password");
}
