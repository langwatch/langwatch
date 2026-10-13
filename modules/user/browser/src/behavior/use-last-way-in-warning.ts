import { lastWayInWarningFor, type LastWayInWarning } from "../model/last-way-in.ts";
import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";
import { isCredentialAccount, passwordOfferFor } from "../model/sign-in-methods.ts";
import { api } from "./personal-workspace-api.ts";

/**
 * The warning for the account this page belongs to, once every count is in
 * hand: a count short by one would be a false alarm about somebody's security.
 */
export function useLastWayInWarning({
  passkeys,
}: {
  passkeys: number | undefined;
}): LastWayInWarning | null {
  const deployment = usePersonalWorkspaceHost().deployment();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const passwordStatus = api.user.hasPassword.useQuery({});

  if (passkeys === undefined || !accounts.data || !passwordStatus.data) return null;
  const password = passwordOfferFor({
    authProvider: deployment.authProvider,
    emailPasswordEnabled: deployment.emailPasswordEnabled ?? false,
    holdsCredentialAccount: accounts.data.some(isCredentialAccount),
    hasPasswordAnswer: passwordStatus.data.hasPassword,
  });

  return lastWayInWarningFor({
    passkeys,
    hasPassword: password?.held === true,
    linked: accounts.data.filter((account) => !isCredentialAccount(account)),
  });
}
