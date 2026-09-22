// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The adapter between the ingestion-pull pipeline's `listAgents` intent and
 * {@link AgentDiscoveryService}.
 *
 * It exists so the service stays a plain function of its arguments. The
 * service takes an organization and a source and returns what happened; it
 * does not know a pipeline exists, does not read a clock, and cannot start
 * itself. Everything that makes a listing HAPPEN — the lease, the retry, the
 * concurrency bound, the instant — is on this side of the line.
 *
 * The pipeline hands over a source id and no organization, the same way it
 * does for a pull run. Resolving the organization here rather than carrying it
 * on the intent keeps tenancy out of the process-manager state, where it would
 * have to be kept in step with a source that can be moved or deleted.
 */

import type { AgentListingPort } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/process-manager/ingestionPullEffects";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

import { AgentDiscoveryService } from "../agentDiscovery.service";

const logger = createLogger("langwatch:governance:agent-listing-port");

/**
 * Builds the port the pipeline dispatches through.
 *
 * `clock` is injectable for the same reason the service takes `now`: a test
 * asserts on the instant it supplied rather than on wall time.
 */
export function createAgentListingPort({
  prisma,
  clock = () => new Date(),
}: {
  prisma: PrismaClient;
  clock?: () => Date;
}): AgentListingPort {
  const service = AgentDiscoveryService.create(prisma);

  return {
    async list({ sourceId }) {
      const source = await prisma.ingestionSource.findUnique({
        where: { id: sourceId },
        select: { organizationId: true },
      });
      // A source that is gone is not a provider refusal, and retrying will not
      // bring it back. Throwing would burn three attempts to reach the same
      // place, so report it as the one refusal reason that means "there was
      // nothing here to ask".
      if (!source) {
        logger.warn(
          { ingestionSourceId: sourceId },
          "agent listing asked for a source that no longer exists",
        );
        return { outcome: "refused", reason: "not_found", status: null };
      }

      const result = await service.syncFromSource({
        organizationId: source.organizationId,
        ingestionSourceId: sourceId,
        now: clock(),
      });

      if (result.outcome === "refused") {
        return {
          outcome: "refused",
          reason: result.refusal.reason,
          status: result.refusal.status,
        };
      }
      // "Empty" flattens to a zero count and loses nothing: a refusal took the
      // other arm above, so a zero here can only mean the provider answered
      // and named none. The event is what a reader sees, and it keeps the two
      // apart by being a different event entirely.
      return {
        outcome: "listed",
        agentCount: result.outcome === "empty" ? 0 : result.recorded,
      };
    },
  };
}
