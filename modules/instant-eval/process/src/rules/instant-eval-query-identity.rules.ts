/**
 * A LangWatchQL identity the deployment names but ClickHouse will not log in is the same
 * condition as one it never provisioned.
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */

/** ClickHouse's AUTHENTICATION_FAILED, as the driver reports it. */
const AUTHENTICATION_FAILED_CODE = "516";

/** Whether a failed pass was ClickHouse refusing the query identity's login. */
export function isInstantEvalQueryIdentityRefused(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, type, message } = error as { code?: unknown; type?: unknown; message?: unknown };
  if (String(code) === AUTHENTICATION_FAILED_CODE || type === "AUTHENTICATION_FAILED") return true;

  return typeof message === "string" && message.includes("AUTHENTICATION_FAILED");
}
