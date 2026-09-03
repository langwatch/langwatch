import type { Auth } from "~/server/better-auth";

/**
 * The better-auth instance, resolved on the CALL rather than on the import.
 *
 * THIS DEFERRAL IS WHAT LETS THE COMPOSITION ROOT STAY ONE FILE. The two
 * adapters below it — the link-proposal directory and the two-step protocol —
 * reach better-auth's own endpoints, and `server/better-auth/index.ts` builds
 * its plugin list and its storage adapter AT MODULE LOAD out of `runtime.ts`'s
 * exports. A static edge from `runtime.ts` to those adapters would therefore
 * close a cycle that crashes whichever side is entered second: entering
 * `runtime.ts` first evaluates better-auth against a half-initialized module
 * and dies on `Cannot access 'identityStorage' before initialization`. That is
 * the cycle the three satellite `*-runtime.ts` files used to sidestep by
 * living outside `runtime.ts`; deferring the module edge to the first call
 * removes the cycle instead of routing around it, and by then both modules are
 * fully evaluated.
 *
 * It is the one deferred module edge in the identity tree, and it is
 * deliberate rather than convenient: nothing here is optional or expensive,
 * and the only thing being bought is evaluation ORDER.
 */
export const betterAuthInstance = async (): Promise<Auth> => {
  const { auth } = await import("~/server/better-auth");
  return auth;
};
