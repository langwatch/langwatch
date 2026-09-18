import { extractEmailDomain } from "@ee/sso/matching";
import { normalizeDomain } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:better-auth:registered-issuers");

/** Fresh issuer reads fail closed at the request boundary. */
export interface SsoIssuerDirectoryPort {
  /** The issuer one connection registered, or null when it registered none. */
  findIssuerForConnection(args: {
    connectionId: string;
  }): Promise<string | null>;
  findIssuerForDomain(args: { domain: string }): Promise<string | null>;
}

export interface RegisteredIssuersDeps {
  issuers: SsoIssuerDirectoryPort;
}

/**
 * Whether this request could need an issuer fetched.
 *
 * Matched on the path rather than the method: the plugin's sign-in, callback
 * and registration routes all live under the same segment, and a check that
 * tried to enumerate them would go stale the first time one was renamed.
 */
export function isSingleSignOnRequest(request: Request | undefined): boolean {
  if (!request?.url) return false;
  try {
    return new URL(request.url).pathname.includes("/sso");
  } catch {
    return false;
  }
}

/**
 * The connection id this request is about, from the path.
 *
 * `/sso/callback/:providerId` and `/sso/saml2/sp/acs/:providerId` both carry
 * it, and for us a provider id IS a connection id — the projection keys the
 * engine's row on it.
 */
function connectionIdInPath(pathname: string): string | null {
  const match =
    /\/sso\/callback\/([^/?#]+)/.exec(pathname) ??
    /\/sso\/saml2\/sp\/acs\/([^/?#]+)/.exec(pathname);
  return match?.[1] ?? null;
}

const ssoRequestBody = z.object({
  providerId: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  email: z.string().optional(),
});
type SsoRequestBody = z.infer<typeof ssoRequestBody>;

/** Parse a sign-in body without consuming the caller's stream. */
async function requestBody(request: Request): Promise<SsoRequestBody | null> {
  try {
    const body = ssoRequestBody.safeParse(await request.clone().json());
    return body.success ? body.data : null;
  } catch {
    return null;
  }
}

/** Browser trust is limited to the connection selected by this request. */
export class RegisteredIssuers {
  constructor(private readonly deps: RegisteredIssuersDeps) {}

  /** Missing or ambiguous targets never inherit another tenant's origin. */
  async issuersForRequest(request: Request | undefined): Promise<string[]> {
    if (!request || !isSingleSignOnRequest(request)) return [];

    const body = await requestBody(request);
    const connectionId =
      connectionIdInPath(new URL(request.url).pathname) ?? body?.providerId;
    if (!connectionId) return this.issuerForDomainRequest(body);

    const only = await this.issuerForConnection(connectionId);
    return only === null ? [] : [only];
  }

  private async issuerForDomainRequest(
    body: SsoRequestBody | null,
  ): Promise<string[]> {
    try {
      const domain = body?.domain ?? extractEmailDomain(body?.email ?? "");
      if (!domain) return [];
      const issuer = await this.deps.issuers.findIssuerForDomain({
        domain: normalizeDomain(domain),
      });
      return issuer === null ? [] : [issuer];
    } catch {
      return [];
    }
  }

  private async issuerForConnection(
    connectionId: string,
  ): Promise<string | null> {
    try {
      return await this.deps.issuers.findIssuerForConnection({ connectionId });
    } catch (error) {
      logger.warn(
        { error, connectionId },
        "could not read the single sign-on issuer for this request",
      );
      return null;
    }
  }
}
