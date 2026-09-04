/**
 * The process's ONE answer to "did this request come from our own origin?".
 *
 * Every cookie-authed door needs it — a session cookie is `SameSite=Lax`, so a
 * cross-site top-level GET and a cross-site simple POST both arrive carrying
 * it — and two doors answering the question differently is how one of them ends
 * up wrong. The dataset direct-upload authorizer and the subscription lane both
 * read this.
 */
import type { Context } from "hono";

/**
 * `Sec-Fetch-Site` is the primary signal — set by every modern browser based on
 * the real request initiator and unaffected by reverse proxies; `cross-site` is
 * exactly the CSRF vector, while `same-origin`/`same-site`/`none` (direct nav)
 * are legitimate. For older browsers that omit it, fall back to comparing the
 * `Origin` host against the forwarded/Host header.
 */
export function isCrossSiteRequest(c: Context): boolean {
  const secFetchSite = c.req.header("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "cross-site";
  }
  const origin = c.req.header("origin");
  // Fail CLOSED: with neither `Sec-Fetch-Site` nor `Origin` there is no positive
  // same-site signal, so treat it as cross-site. A real same-site request from
  // the UI always carries one of the two, so this only rejects
  // pathological/forged contexts — never a legitimate browser call.
  if (!origin) return true;
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // malformed Origin → treat as cross-site
  }
}
