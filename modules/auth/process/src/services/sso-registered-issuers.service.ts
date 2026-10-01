import { extractEmailDomain } from "@langwatch/auth-contract";
import type { Logger } from "@langwatch/observability";

import {
  findConnectionIdsInPath,
  isSingleSignOnPath,
  ssoRequestTargetSchema,
  type SsoRequestTarget,
} from "../rules/sso-request-target.rules.ts";

/** Which issuers the connections this installation holds registered. Answered
 *  by the module that owns them; auth holds no connection of its own. */
export interface SsoIssuerDirectory {
  findIssuersForConnection(args: { connectionId: string }): Promise<string[]>;
  findIssuersForDomain(args: { domain: string }): Promise<string[]>;
}

export interface SsoRegisteredIssuersServiceDeps {
  issuers: SsoIssuerDirectory;
  logger: Logger;
}

/**
 * The issuers ONE request may reach. Scoped to the connection it names: the
 * same list gates the `Origin` header and `callbackURL`, so answering the
 * whole set would make one tenant's origin every other tenant's redirect.
 */
export class SsoRegisteredIssuersService {
  static create(deps: SsoRegisteredIssuersServiceDeps): SsoRegisteredIssuersService {
    return new SsoRegisteredIssuersService(deps);
  }

  private constructor(private readonly deps: SsoRegisteredIssuersServiceDeps) {}

  /** A request that names no target, or names one nobody registered, inherits
   *  nothing: the empty list leaves only this deployment's own address. */
  async issuersForRequest(request: Request | undefined): Promise<string[]> {
    if (!request || !isSingleSignOnPath(request.url)) return [];

    const target = await this.target(request);
    const [named] = findConnectionIdsInPath(request.url);
    const connectionId = named ?? target?.providerId;
    return connectionId ? this.issuersFor({ connectionId }) : this.issuersForDomainIn(target);
  }

  /** Parsed off a clone, so the handler still reads its own body. */
  private async target(request: Request): Promise<SsoRequestTarget | null> {
    try {
      const parsed = ssoRequestTargetSchema.safeParse(await request.clone().json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async issuersForDomainIn(target: SsoRequestTarget | null): Promise<string[]> {
    const domain = target?.domain ?? extractEmailDomain(target?.email ?? "");
    if (!domain) return [];
    return this.read(() => this.deps.issuers.findIssuersForDomain({ domain }), { domain });
  }

  private async issuersFor({ connectionId }: { connectionId: string }): Promise<string[]> {
    return this.read(() => this.deps.issuers.findIssuersForConnection({ connectionId }), {
      connectionId,
    });
  }

  /**
   * An unreadable directory trusts nothing new rather than refusing every
   * sign-in of every kind — logged at warn, because a directory we cannot
   * reach is a real fault even where it degrades.
   */
  private async read(
    issuers: () => Promise<string[]>,
    about: Record<string, string>,
  ): Promise<string[]> {
    try {
      return await issuers();
    } catch (error) {
      this.deps.logger.warn(
        { error, ...about },
        "could not read the registered single sign-on issuers for this request; it will be trusted with this deployment's own origins only",
      );
      return [];
    }
  }
}
