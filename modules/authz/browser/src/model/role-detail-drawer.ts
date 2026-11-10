// What a role can do, as a routed drawer only this module opens (ARCHITECTURE.md §10.1).

import { uiTokens } from "@langwatch/module";

/** `role` is a built-in key (admin, member, viewer, billing) or a custom role's id. */
export type RoleDetailDrawerProps = {
  open?: boolean;
  role?: string;
};

export const RoleDetailDrawerToken = uiTokens("authz").drawer<RoleDetailDrawerProps>("roleDetail");
