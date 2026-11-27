import type { Authorization } from "@langwatch/authorization";
import type { CodingAgentAccountBurndownPage } from "@langwatch/coding-agent-contract";

import type { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository.ts";
import { accountWeekWindow, buildAccountBurndowns } from "../rules/coding-agent-account.rules.ts";
import type { CodingAgentClock } from "./coding-agent-clock.service.ts";

/**
 * The trailing week of the subscription accounts a proof may read (an aggregate project spans its
 * members, as the sessions list does): what each spent per UTC day, and the usage each last
 * reported. Only reported figures are shown; nothing is derived from tokens.
 * @see specs/coding-agent/account-burndown.feature
 */
export class CodingAgentAccountBurndownService {
  static create(deps: {
    sessionEvents: CodingAgentSessionEventRepository;
    clock: CodingAgentClock;
  }): CodingAgentAccountBurndownService {
    return new CodingAgentAccountBurndownService(deps.sessionEvents, deps.clock);
  }

  private constructor(
    private readonly sessionEvents: CodingAgentSessionEventRepository,
    private readonly clock: CodingAgentClock,
  ) {}

  async readWeek(input: {
    authorization: Authorization;
    canSeeCosts: boolean;
  }): Promise<CodingAgentAccountBurndownPage> {
    const nowMs = this.clock.nowMs();
    const { fromMs, days } = accountWeekWindow(nowMs);
    const groups = await this.sessionEvents.summariseAccountUsage({
      authorization: input.authorization,
      fromMs,
      toMs: nowMs + 1,
    });

    return {
      accounts: buildAccountBurndowns({ groups, days, canSeeCosts: input.canSeeCosts, nowMs }),
    };
  }
}
