/** What github lends langy by token (ARCHITECTURE.md §3.4, §10.1). */

import { useLentHooks } from "@langwatch/browser-host/lent";
import { type GithubConnectPopup, GithubConnectPopupToken } from "@langwatch/github-client";

/** What a composition without github reads: every connect fails, naming why. */
const NO_POPUP: GithubConnectPopup = {
  useConnectPopup: () => ({
    connect: async () => ({ ok: false, reason: "failed", error: "GitHub is not installed" }),
  }),
};

/** Opens the GitHub App installation github lends. A hook: call it during render. */
export function useGitHubConnectPopup() {
  return (useLentHooks(GithubConnectPopupToken) ?? NO_POPUP).useConnectPopup();
}
