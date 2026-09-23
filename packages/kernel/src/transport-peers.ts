/**
 * What a process's doors are built from, once every module is installed:
 * a FACTORY, since a door can't be built before boot (route credentials
 * resolve through modules boot installs) or after (bind-first 404s everything).
 */
import type { DependencyToken, TokenIdentity } from "./dependency-token.ts";
import { tokenName } from "./dependency-token.ts";

/** One module's App this build installed, reached by its contract token. */
export interface TransportPeers {
  /**
   * The App behind one contract token. A token this build installed no module
   * for is a wiring bug in the process's own door table, so it is refused by
   * token name rather than answered with a door that resolves nobody.
   */
  app<Instance>(token: DependencyToken<Instance>): Instance;
  /**
   * The same, answering nothing where this build installed no such module.
   * Only a door a deployment may legitimately run without asks this way.
   */
  find<Instance>(token: DependencyToken<Instance>): Instance | undefined;
}

/**
 * A process's own door table names a module this build never installed. The
 * refusal names the token, because that is what the reader has to act on.
 */
export class MissingTransportPeerError extends Error {
  constructor(readonly token: string) {
    super(`This process builds its doors from ${token}, and no installed module provides it.`);
    this.name = "MissingTransportPeerError";
  }
}

/** The peers a booting application hands its door factory. */
export function transportPeersOf(resolve: (token: TokenIdentity) => unknown): TransportPeers {
  return {
    app: <Instance>(token: DependencyToken<Instance>): Instance => {
      const instance = resolve(token as TokenIdentity);
      if (instance === void 0)
        throw new MissingTransportPeerError(tokenName(token as TokenIdentity));
      return instance as Instance;
    },
    find: <Instance>(token: DependencyToken<Instance>): Instance | undefined =>
      resolve(token as TokenIdentity) as Instance | undefined,
  };
}
