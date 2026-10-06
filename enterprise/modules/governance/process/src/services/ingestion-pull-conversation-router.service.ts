import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";

import type {
  ConversationRoutingProfile,
  RoutingOrigin,
} from "../rules/conversation-trace-assembly-service.rules.ts";
import { COPILOT_ROUTING_PROFILE } from "../rules/copilot-studio-trace-mapper-service.rules.ts";
import * as CopilotStudioTraceMapperService from "../rules/copilot-studio-trace-mapper-service.rules.ts";
import { GENIE_ROUTING_PROFILE } from "../rules/genie-trace-mapper-service.rules.ts";
import * as GenieTraceMapperService from "../rules/genie-trace-mapper-service.rules.ts";
import type { IngestionPullDiagnosticsSink } from "./ingestion-pull-log.service.ts";
import type {
  GovernanceProjectDirectory,
  GovernanceTraceIngestionClient,
  GovernanceTraceRequest,
} from "./ingestion-pull-worker.service.ts";

type ConversationRouting = {
  profile: ConversationRoutingProfile;
  map(input: {
    events: NormalizedPullEvent[];
    origin: RoutingOrigin;
  }): GovernanceTraceRequest | null;
};

const CONVERSATION_ROUTING = new Map<string, ConversationRouting>([
  [
    "databricks_genie",
    { profile: GENIE_ROUTING_PROFILE, map: GenieTraceMapperService.toTraceRequest },
  ],
  [
    "copilot_studio_dataverse",
    { profile: COPILOT_ROUTING_PROFILE, map: CopilotStudioTraceMapperService.toTraceRequest },
  ],
]);

/** A pull's conversations, assembled into traces for the trace door of the source's project. */
export class IngestionPullConversationRouterService {
  private constructor(
    private readonly projects: Pick<GovernanceProjectDirectory, "findWithTeam">,
    private readonly traceIngestion: GovernanceTraceIngestionClient | undefined,
    private readonly diagnostics: IngestionPullDiagnosticsSink,
  ) {}

  static create(members: {
    projects: Pick<GovernanceProjectDirectory, "findWithTeam">;
    traceIngestion: GovernanceTraceIngestionClient | undefined;
    diagnostics: IngestionPullDiagnosticsSink;
  }): IngestionPullConversationRouterService {
    return new IngestionPullConversationRouterService(
      members.projects,
      members.traceIngestion,
      members.diagnostics,
    );
  }

  async routeConversations(input: {
    events: NormalizedPullEvent[];
    source: GovernanceIngestionSource;
  }): Promise<void> {
    const { source } = input;
    if (!source.traceProjectId) {
      return;
    }

    const routing = CONVERSATION_ROUTING.get(source.sourceType);
    if (!routing) {
      return;
    }

    if (!this.traceIngestion) {
      throw new Error("Conversation trace ingestion is not composed");
    }

    const request = routing.map({
      events: input.events,
      origin: {
        ingestionSourceId: source.id,
        organizationId: source.organizationId,
        sourceType: source.sourceType,
        profile: routing.profile,
      },
    });
    if (!request) {
      return;
    }

    const project = await this.projects.findWithTeam(source.traceProjectId);
    const destinationIsLive =
      project !== null &&
      project.archivedAt === null &&
      project.team.organizationId === source.organizationId;
    if (!destinationIsLive) {
      this.diagnostics.warn(
        "trace destination is archived, deleted, or belongs to another organization",
        { ingestionSourceId: source.id, traceProjectId: source.traceProjectId },
      );

      return;
    }

    const result = await this.traceIngestion.ingest({
      projectId: project.id,
      request,
    });
    if (result.ingestionFailures === 0) {
      return;
    }

    const detail = result.ingestionFailureMessage ? `: ${result.ingestionFailureMessage}` : "";

    throw new Error(
      `Trace door failed to dispatch ${result.ingestionFailures} span(s) for ingestion source ${source.id}${detail}`,
    );
  }
}
