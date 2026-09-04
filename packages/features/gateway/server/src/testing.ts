/**
 * Test-only concrete capability access for feature characterization suites.
 *
 * Reachable only from here on purpose. The package's public surface is its
 * barrel and the named composition subpaths; a service and a repository behind
 * them are implementations of ports, and application code importing one
 * directly is how the port stops being the seam.
 *
 * A characterization suite is the one caller with a reason: spend accounting
 * asserted against an in-memory double asserts the double, not the ClickHouse
 * arithmetic that actually bills. So the access is named as test-only here
 * rather than opened to everyone.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { VirtualKeyCryptoAdapter } from "./adapters/virtual-key-crypto.adapter";
import { PrismaGatewayAuditRepository } from "./repositories/prisma/prisma.gateway-audit.repository";
import { PrismaGatewayChangeEventsRepository } from "./repositories/prisma/prisma.gateway-change-event.repository";
import { PrismaGatewayVirtualKeyRepository } from "./repositories/prisma/prisma.virtual-key.repository";
import { VirtualKeyService } from "./services/virtual-key.service";

export { GatewayUsageService } from "./services/gateway-usage.service";

/**
 * The write-path service wired to this deployment's Postgres, with a fixed
 * test pepper. Characterization suites assert against real rows, so they
 * compose the concrete repositories the way a process does.
 */
export function createVirtualKeyServiceForTest(
  prisma: PrismaClient,
  projects: ProjectService,
): VirtualKeyService {
  return VirtualKeyService.create({
    prisma,
    projects,
    repository: PrismaGatewayVirtualKeyRepository.create(prisma),
    changeEvents: PrismaGatewayChangeEventsRepository.create(prisma),
    auditLog: PrismaGatewayAuditRepository.create(prisma),
    crypto: VirtualKeyCryptoAdapter.create({ pepper: "test-virtual-key-pepper" }),
  });
}
