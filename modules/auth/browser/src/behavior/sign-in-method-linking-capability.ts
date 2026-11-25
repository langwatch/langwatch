/**
 * Linking another sign-in method to the reader's own account, lent to the
 * personal workspace. Travels by declaration (ARCHITECTURE.md §10.1, kit rule 7).
 */

import { linkCallbackUrl } from "./auth-client.tsx";
import { linkUiSignInMethod, type UiLinkSignInMethodOutcome } from "./ui-passkeys.ts";

/**
 * Back to the page the link started from once the provider answers, through
 * the resume page when better-auth would refuse the address itself.
 */
function currentPage(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export const signInMethodLinkingCapability = {
  link: ({ provider }: { provider: string }): Promise<UiLinkSignInMethodOutcome> =>
    linkUiSignInMethod(provider, { callbackUrl: linkCallbackUrl(currentPage()) }),
};

export default signInMethodLinkingCapability;
