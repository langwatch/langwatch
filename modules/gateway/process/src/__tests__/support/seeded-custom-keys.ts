import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { GatewayCustomKeys } from "../../services/gateway-config-materialisation.service.ts";

/**
 * Model provider's custom-key read over rows a suite seeds unencrypted: the keys as stored,
 * and an empty bag for a row that stores none, read afresh so a rotation shows.
 */
export function seededCustomKeys(prisma: PrismaClient): GatewayCustomKeys {
  return {
    getCustomKeys: async ({ modelProviderId }) => {
      const row = await prisma.modelProvider.findUniqueOrThrow({
        where: { id: modelProviderId },
        select: { id: true, provider: true, organizationId: true, customKeys: true },
      });
      const stored = row.customKeys;
      const customKeys =
        typeof stored === "object" && stored !== null && !Array.isArray(stored) ? stored : {};
      return { id: row.id, provider: row.provider, organizationId: row.organizationId, customKeys };
    },
  };
}
