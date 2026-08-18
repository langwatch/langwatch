/**
 * Where the Slack integration service meets Prisma.
 *
 * The service itself depends only on `SlackIntegrationRepository`, the port
 * declared next to it. Hosting the `new PrismaSlackIntegrationRepository(...)`
 * call there for convenience would have given an app-layer service a
 * compile-time dependency on the concrete implementation it exists to be
 * independent of, so the composition lives here instead — one module, imported
 * by the callers that already hold a `PrismaClient`.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaSlackIntegrationRepository } from "./repositories/slack-integration.prisma.repository";
import { SlackIntegrationService } from "./slack-integration.service";

export function createSlackIntegrationService({
  prisma,
}: {
  prisma: PrismaClient;
}): SlackIntegrationService {
  return new SlackIntegrationService(
    new PrismaSlackIntegrationRepository(prisma),
  );
}
