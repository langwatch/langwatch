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

class GatewayProviderCredentialServiceImpl {
  constructor(_prisma: PrismaClient) {}

  list(_args?: unknown): never {
    deprecated();
  }
  listForOrg(_args?: unknown): never {
    deprecated();
  }
  countByModelProvider(_args?: unknown): never {
    deprecated();
  }
  get(_args?: unknown): never {
    deprecated();
  }
  create(_args?: unknown): never {
    deprecated();
  }
  update(_args?: unknown): never {
    deprecated();
  }
  disable(_args?: unknown): never {
    deprecated();
  }
  enable(_args?: unknown): never {
    deprecated();
  }
  destroy(_args?: unknown): never {
    deprecated();
  }
  disableAllForModelProvider(_args?: unknown): never {
    deprecated();
  }
}

export class GatewayProviderCredentialService {
  static create(prisma: PrismaClient): GatewayProviderCredentialServiceImpl {
    return new GatewayProviderCredentialServiceImpl(prisma);
  }
}
