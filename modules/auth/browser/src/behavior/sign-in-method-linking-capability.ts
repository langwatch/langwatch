/**
 * Linking another sign-in method to the reader's own account, lent to the
 * personal workspace. Travels by declaration (ARCHITECTURE.md §10.1, kit rule 7).
 */

import { linkUiSignInMethod, type UiLinkSignInMethodOutcome } from "./ui-passkeys.ts";

/** Back to the page the link started from once the provider answers, as main does. */
function currentPage(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export const signInMethodLinkingCapability = {
  link: ({ provider }: { provider: string }): Promise<UiLinkSignInMethodOutcome> =>
    linkUiSignInMethod(provider, { callbackUrl: currentPage() }),
};

export default signInMethodLinkingCapability;
