import { CodingAgentService } from "@langwatch/coding-agent-contract";

export class TestCodingAgentService extends CodingAgentService {
  private unused(): Promise<never> {
    return Promise.reject(new Error("unused coding agent capability"));
  }

  getSessionEvents(): Promise<never> {
    return this.unused();
  }

  tryGetBySessionId(): Promise<never> {
    return this.unused();
  }

  tryGetSessionForTrace(): Promise<never> {
    return this.unused();
  }

  listRecent(): Promise<never> {
    return this.unused();
  }

  backfillPullRequestMappings(): Promise<never> {
    return this.unused();
  }

  getUsageTotals(): Promise<never> {
    return this.unused();
  }

  listForProject(): Promise<never> {
    return this.unused();
  }

  linkTraceSessionsToPullRequests(): Promise<never> {
    return this.unused();
  }

  getPullRequestUsage(): Promise<never> {
    return this.unused();
  }

  getPullRequestDetail(): Promise<never> {
    return this.unused();
  }

  getForPersonalProject(): Promise<never> {
    return this.unused();
  }
}
