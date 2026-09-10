import { createHttpProxyTrpcRouter } from "./http-proxy-trpc.mount.ts";
import type { ComposedHttpProxyFeature } from "./http-proxy.composition.types.ts";

export function composeHttpProxyFeature(): ComposedHttpProxyFeature {
  return { router: (mount) => createHttpProxyTrpcRouter(mount.runtime) };
}
