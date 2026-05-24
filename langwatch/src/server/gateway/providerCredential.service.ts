/**
 * GatewayProviderCredential service — gone after S0 collapsed the
 * binding table onto ModelProvider directly (iter 110).
 *
 * This file is a temporary import-stability shim while consumers
 * (gatewayProviders.ts tRPC router, gateway-platform Hono routes,
 * VK drawers) get rewritten through Sergey's S1 + Alexis's A1/A3
 * lanes. Every method throws so the deprecation is loud and the
 * rewrite can't accidentally silently no-op a path that used to
 * persist data.
 *
 * Delete this file the moment the last `import` of
 * `~/server/gateway/providerCredential.service` is gone.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

const DEPRECATED =
  "GatewayProviderCredentialService is removed in iter 110 — the binding " +
  "table folded onto ModelProvider. Use ModelProvider directly (Advanced " +
  "tab fields for gateway-routing knobs) or RoutingPolicy.modelProviderIds " +
  "for per-VK chain ordering.";

function deprecated(): never {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: DEPRECATED });
}

// Loose proxy: every property access returns a function that throws at
// runtime. Lets legacy consumers compile (any `service.foo(...)` call,
// any field access on the imagined result) without us having to
// hand-enumerate the call surface across both the tRPC router (A1) and
// the public REST surface (S1b). The whole file disappears once both
// rewrites land.
const loose: any = new Proxy(function () {}, {
  get(_, prop) {
    if (prop === "then" || prop === Symbol.toPrimitive) return undefined;
    return loose;
  },
  apply() {
    deprecated();
  },
});

class GatewayProviderCredentialServiceImpl {
  constructor(_prisma: PrismaClient) {
    return loose;
  }
}

export class GatewayProviderCredentialService {
  static create(prisma: PrismaClient): any {
    return new GatewayProviderCredentialServiceImpl(prisma);
  }
}
