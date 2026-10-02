/** The ceremonies auth lends a reader's own account screens by token (§10.1). */

import { uiTokens } from "@langwatch/module";
import type { TimeInput } from "@langwatch/time";

/** How a device ceremony ended: `cancelled` is a dismissed prompt, not a refusal. */
export type UiCeremonyOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false };
/** One passkey the reader holds, as auth lends it. */
export type UiHeldPasskey = {
  id: string;
  name?: string | null;
  createdAt: TimeInput;
  transports?: string | null;
};
/** What auth lends the screen where a reader manages their own passkeys. */
export type UiPasskeyCeremonies = {
  list(): Promise<readonly UiHeldPasskey[]>;
  register(): Promise<UiCeremonyOutcome>;
  rename(input: { id: string; name: string }): Promise<UiCeremonyOutcome>;
  remove(input: { id: string }): Promise<UiCeremonyOutcome>;
};
/** The value, or the refusal as the endpoint answered it, for the registry to read by code. */
export type UiTwoStepAnswer<Value> = { ok: true; value: Value } | { ok: false; error: unknown };
/** What auth lends for setting two-step verification up; no password where the account has none. */
export type UiTwoStepCeremonies = {
  start(input: {
    password?: string;
  }): Promise<UiTwoStepAnswer<{ setupUri: string; backupCodes: readonly string[] }>>;
  confirm(input: { code: string }): Promise<UiTwoStepAnswer<{ confirmed: true }>>;
  regenerateBackupCodes(input: {
    password?: string;
  }): Promise<UiTwoStepAnswer<{ backupCodes: readonly string[] }>>;
};

/** How linking a further sign-in method ended; `reason` is the provider's refusal to show. */
export type UiLinkSignInMethodOutcome = { ok: true } | { ok: false; reason?: string };
/** What auth lends for linking another sign-in method to the reader's own account. */
export type UiSignInMethodLinking = {
  link(input: { provider: string }): Promise<UiLinkSignInMethodOutcome>;
};

export const PasskeyCeremoniesToken = uiTokens("auth").operations<UiPasskeyCeremonies>("passkeys");
export const TwoStepCeremoniesToken =
  uiTokens("auth").operations<UiTwoStepCeremonies>("twoStepVerification");
export const SignInMethodLinkingToken =
  uiTokens("auth").operations<UiSignInMethodLinking>("signInMethodLinking");
