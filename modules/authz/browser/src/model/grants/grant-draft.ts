import type { GrantScopeType } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

export type GrantScope = { type: GrantScopeType; id: string };

/** A new grant, as the dialog collects it. */
export type GrantDraft = {
  principal: { type: "user" | "group"; id: string };
  roleId: string;
  scope: GrantScope;
  expiresAt?: Instant;
};
