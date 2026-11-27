import {
  LangyConversationNotFoundError,
  type LangyApi,
  type LangyToolCallFacts,
} from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  StaffFunctionNotFoundError,
  type STAFF_ACCESS_LANGY_FUNCTIONS,
  type StaffAccessFunctionInput,
  type StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import {
  pageOf,
  rangeOf,
  type StaffAccessPage,
  isoOfMs,
  pageInputOf,
} from "../rules/staff-access-function.rules.ts";
import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

/** How many tool calls one turn of `org.langy_turn` answers; `truncated` says when it ran more. */
const TOOL_CALLS_PER_TURN = 100;

type LangyReadsDeps = Readonly<{
  langy: Pick<LangyApi, "findTurnOutcomeCounts" | "getTurnFacts">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
}>;

/** The langy ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessLangyFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_LANGY_FUNCTIONS>;

  private constructor(private readonly deps: LangyReadsDeps) {
    this.reads = {
      "org.langy": (call) => this.turnOutcomes(call),
      "org.langy_turn": (call) => this.conversationTurns(call),
    };
  }

  static create(deps: LangyReadsDeps): StaffAccessLangyFunctionReadsService {
    return new StaffAccessLangyFunctionReadsService(deps);
  }

  private async turnOutcomes({
    input,
    organizationId,
    at,
  }: {
    input: StaffAccessFunctionInput<"org.langy">;
    organizationId: string;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"org.langy">> {
    const range = rangeOf({
      since: input.since,
      ...(input.until ? { until: input.until } : {}),
      at,
    });
    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    const { counts, truncated } = await this.deps.langy.findTurnOutcomeCounts({
      projectIds,
      since: range.since.epochMilliseconds,
      until: range.until.epochMilliseconds,
    });
    const rows = counts.map((count) => ({
      day: count.day,
      model: count.model,
      turnState: count.turnState,
      failureCode: count.failureCode,
      toolErrorsByTool: { ...count.toolErrorsByTool },
      turns: count.turns,
      users: count.users,
      turnScanComplete: !truncated,
    }));
    return pageOf({
      rows,
      keyOf: (row) => [row.day, row.model, row.turnState, row.failureCode ?? ""].join("|"),
      name: "org.langy",
      ...pageInputOf(input),
    });
  }

  /** @throws {StaffFunctionNotFoundError} for another organization's project or conversation */
  private async conversationTurns({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"org.langy_turn">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.langy_turn">> {
    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    if (!projectIds.includes(input.projectId)) throw new StaffFunctionNotFoundError();
    const turns = await this.deps.langy
      .getTurnFacts({ projectId: input.projectId, conversationId: input.conversationId })
      .catch((error: unknown) => {
        if (error instanceof LangyConversationNotFoundError) throw new StaffFunctionNotFoundError();
        throw error;
      });
    const rows = turns.map((turn) => ({
      turnId: turn.turnId,
      createdAt: isoOfMs(turn.createdAt),
      startedAt: turn.startedAt === null ? null : isoOfMs(turn.startedAt),
      endedAt: turn.endedAt === null ? null : isoOfMs(turn.endedAt),
      state: turn.state,
      failureCode: turn.failureCode,
      toolCalls: toolCallsPageOf(turn.toolCalls),
    }));
    return pageOf({
      rows,
      keyOf: (row) => `${row.createdAt}|${row.turnId}`,
      name: "org.langy_turn",
      ...pageInputOf(input),
    });
  }
}

function toolCallsPageOf(
  calls: readonly LangyToolCallFacts[],
): StaffAccessPage<LangyToolCallFacts> {
  const items = calls.slice(0, TOOL_CALLS_PER_TURN).map((call) => ({ ...call }));
  return {
    items,
    total: calls.length,
    truncated: calls.length > items.length,
    nextCursor: null,
  };
}
