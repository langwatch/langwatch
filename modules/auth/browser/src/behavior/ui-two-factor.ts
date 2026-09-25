/**
 * Two-step verification ceremonies live here, beside the passkey ones, so a
 * screen never imports `better-auth` or `fetch`. Refusals travel as the
 * endpoint answered them: the server speaks our own codes, the registry the words.
 */

import { signInRefusalOf } from "../model/sso-sign-in-answer.ts";

/** Better Auth's two-factor endpoints, mounted under the auth base path. */
const TWO_FACTOR_PATH = "/api/auth/two-factor";

/** The value, or the refusal as the endpoint answered it, for the registry to read by code. */
export type UiTwoStepAnswer<Value> = { ok: true; value: Value } | { ok: false; error: unknown };

/** A started setup: the link the scannable code and the typed key both come from. */
export type UiTwoStepSetup = { setupUri: string; backupCodes: readonly string[] };

/** The one seam a test takes over: posting a body to a two-factor endpoint. */
export type UiTwoFactorPost = (
  endpoint: "enable" | "verify-totp" | "generate-backup-codes",
  body: Readonly<Record<string, string>>,
) => Promise<UiTwoStepAnswer<unknown>>;

const postToTwoFactor: UiTwoFactorPost = async (endpoint, body) => {
  const response = await fetch(`${TWO_FACTOR_PATH}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const answered: unknown = await response.json().catch(() => void 0);
  if (!response.ok) {
    return {
      ok: false,
      error: signInRefusalOf({
        status: response.status,
        statusText: response.statusText,
        body: answered,
      }),
    };
  }
  return { ok: true, value: answered };
};

function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((one) => typeof one === "string") : [];
}

/** The two fields the plugin's answers carry, read without trusting their shape. */
function answerOf(data: unknown): { totpURI?: unknown; backupCodes: readonly string[] } {
  if (typeof data !== "object" || data === null) return { backupCodes: [] };
  return {
    totpURI: "totpURI" in data ? data.totpURI : void 0,
    backupCodes: stringsOf("backupCodes" in data ? data.backupCodes : void 0),
  };
}

/**
 * An account that holds no password passes none and the plugin waives it;
 * an empty string would be a wrong password, not an absent one.
 */
function passwordBody(password: string | undefined): Readonly<Record<string, string>> {
  return password ? { password } : {};
}

/** Asks for an authenticator setup: the link to scan, and the codes it will hold. */
export async function startUiTwoStepSetup(
  { password }: { password?: string },
  post: UiTwoFactorPost = postToTwoFactor,
): Promise<UiTwoStepAnswer<UiTwoStepSetup>> {
  const answer = await post("enable", passwordBody(password));
  if (!answer.ok) return answer;
  const { totpURI, backupCodes } = answerOf(answer.value);
  if (typeof totpURI !== "string" || totpURI.length === 0) {
    return { ok: false, error: new Error("The authenticator setup link was not issued") };
  }
  return { ok: true, value: { setupUri: totpURI, backupCodes } };
}

/** Finishes the setup with the first code the authenticator produced. */
export async function confirmUiTwoStepSetup(
  { code }: { code: string },
  post: UiTwoFactorPost = postToTwoFactor,
): Promise<UiTwoStepAnswer<{ confirmed: true }>> {
  const answer = await post("verify-totp", { code });
  if (!answer.ok) return answer;
  return { ok: true, value: { confirmed: true } };
}

/** A fresh set of backup codes; every code left from the old set stops working. */
export async function regenerateUiBackupCodes(
  { password }: { password?: string },
  post: UiTwoFactorPost = postToTwoFactor,
): Promise<UiTwoStepAnswer<{ backupCodes: readonly string[] }>> {
  const answer = await post("generate-backup-codes", passwordBody(password));
  if (!answer.ok) return answer;
  return { ok: true, value: { backupCodes: answerOf(answer.value).backupCodes } };
}
