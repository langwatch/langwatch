// Whether a request came from this deployment's own pages.

/** The request headers the guard reads, whatever framework carries them. */
export type OriginBearingRequest = Readonly<{
  req: Readonly<{ header(name: string): string | undefined }>;
}>;

/**
 * A browser attaches this deployment's cookie to cross-site requests too, so "the cookie is valid"
 * and "our own page sent this" differ; only the second keeps a forged form off an endpoint.
 */
export class BrowserOriginGuard {
  /**
   * `Sec-Fetch-Site` is the primary signal — set by every modern browser from the real request
   * initiator and unaffected by reverse proxies. `cross-site` is exactly the forgery vector;
   * `same-origin`, `same-site` and `none` (a direct navigation) are all legitimate.
   */
  static isFromOwnOrigin(request: OriginBearingRequest): boolean {
    const secFetchSite = request.req.header("sec-fetch-site");
    if (secFetchSite) return secFetchSite !== "cross-site";

    const origin = request.req.header("origin");
    // Fail CLOSED: with neither `Sec-Fetch-Site` nor `Origin` there is no
    // positive same-site signal. A real request from the browser application
    // always carries one of the two, so this rejects only forged and
    // pathological contexts, never a legitimate browser call.
    if (!origin) return false;

    const host = request.req.header("x-forwarded-host") ?? request.req.header("host") ?? "";

    try {
      return new URL(origin).host === host;
    } catch {
      // A malformed Origin is not this deployment's own page.
      return false;
    }
  }
}
