// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { HostedCaller, HostedUsageAnswer } from "@langwatch/enterprise-licensing-contract";
import { moduleApi } from "@langwatch/module";

import type { HostedCapAnswer, HostedClassifyAnswer } from "./connect-hosted.ts";

/**
 * The hosted end of Connect (ADR-156 §5), which only LangWatch Cloud serves: a
 * self-hosted install's calls, made under the managed key its license runs on.
 */
export interface ConnectApi {
  /** Judges one text for a caller whose license is entitled to instant evals. */
  classifyForHostedCaller(input: {
    caller: HostedCaller;
    payload: unknown;
    /** The calling install's request: a judgement it no longer waits for is abandoned. */
    signal?: AbortSignal;
  }): Promise<HostedClassifyAnswer>;
  /** What the caller spent against every budget that applies to it. */
  getHostedUsage(input: { caller: HostedCaller }): Promise<HostedUsageAnswer>;
  /** The customer moves its own hosted cap, up to the contract maximum. */
  setHostedBudgetCap(input: { caller: HostedCaller; payload: unknown }): Promise<HostedCapAnswer>;
}

export const ConnectApi = moduleApi<ConnectApi>()("connect");
