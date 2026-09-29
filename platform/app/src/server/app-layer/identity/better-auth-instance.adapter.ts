import type { Auth } from "~/server/better-auth";

/**
 * The better-auth instance, handed IN by the boundary rather than imported by
 * the services.
 *
 * Two adapters below the composition root — the link-proposal directory and
 * the two-step protocol — call better-auth's own endpoints, and
 * `server/better-auth/index.ts` builds its plugin list and its storage
 * adapter out of `runtime.ts`'s exports at module load. A value import from
 * the identity tree back to that module would therefore be a cycle that
 * crashes whichever side is entered second (`Cannot access 'identityStorage'
 * before initialization`). That cycle is what the three satellite
 * `*-runtime.ts` files used to route around.
 *
 * The dependency runs one way instead (ADR-129): the boundary depends on the
 * services, never the reverse. The composition root constructs this handle
 * and gives it to the two adapters; `better-auth/index.ts`, which already
 * imports the composition root, fills it in the moment the instance exists.
 * Nothing in the identity tree names the better-auth module as a value, so
 * there is no cycle to hold together, and the composition root can be one
 * file.
 *
 * Resolving before the boundary has loaded is a wiring fault, not a state to
 * wait out, so it throws rather than returning a promise that never settles.
 */
export class BetterAuthInstanceHandle {
  private instance: Auth | null = null;

  provide(auth: Auth): void {
    this.instance = auth;
  }

  resolve(): Auth {
    if (this.instance === null) {
      throw new Error(
        "better-auth instance requested before server/better-auth/index.ts was loaded",
      );
    }
    return this.instance;
  }
}
