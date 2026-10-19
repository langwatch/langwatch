/** GitHub UI hooks lent by token to the modules that connect the App (§10.1). */

import { uiTokens } from "@langwatch/module";

export type ConnectFailureReason = "popup-blocked" | "cancelled" | "failed";

export type ConnectResult =
  | { ok: true; login: string }
  | { ok: false; error: string; reason: ConnectFailureReason };

/** The App install popup; `useConnectPopup` is a hook, call it during render. */
export type GithubConnectPopup = {
  useConnectPopup(): { connect(organizationId: string): Promise<ConnectResult> };
};

export const GithubConnectPopupToken = uiTokens("github").hooks<GithubConnectPopup>("connectPopup");
