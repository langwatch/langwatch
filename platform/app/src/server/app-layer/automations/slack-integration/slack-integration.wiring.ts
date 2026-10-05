/**
 * Where the Slack connection service meets Prisma, so the service depends only
 * on its repository interface. Callers that hold a `PrismaClient` import these.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaSlackIntegrationRepository } from "./repositories/slack-integration.prisma.repository";
import {
  type SlackDestinationResolver,
  slackDestinationResolver,
} from "./slack-destination-resolver";
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

/** The one Slack resolver every dispatch composition root passes down. */
export function createSlackDestinationResolver({
  prisma,
}: {
  prisma: PrismaClient;
}): SlackDestinationResolver {
  return slackDestinationResolver({
    connections: createSlackIntegrationService({ prisma }),
  });
}
