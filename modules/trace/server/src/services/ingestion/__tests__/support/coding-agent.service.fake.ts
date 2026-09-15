import {
  buildCodingAgentTranscript,
  contentAttrKeys,
  logContentKeys,
  shouldFilterCodingAgentSpan,
  type CodingAgentApi,
  type CodingAgentSpanFilterInput,
} from "@langwatch/coding-agent-contract";

/** A `CodingAgentApi` double: the pure derivations answer for real, everything else refuses. */
export class TestCodingAgentService implements CodingAgentApi {
  private unused(): Promise<never> {
    return Promise.reject(new Error("unused coding agent capability"));
  }

  logContentKeys(eventName: string) {
    return logContentKeys(eventName);
  }

  contentAttrKeys(eventName: string) {
    return contentAttrKeys(eventName);
  }

  shouldFilterSpan(input: CodingAgentSpanFilterInput): boolean {
    return shouldFilterCodingAgentSpan(input);
  }

  buildTranscript(input: Parameters<CodingAgentApi["buildTranscript"]>[0]) {
    return buildCodingAgentTranscript(input);
  }

  getSessionEvents(): Promise<never> {
    return this.unused();
  }

  findBySessionId(): Promise<never> {
    return this.unused();
  }

  findSessionForTrace(): Promise<never> {
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

  recordPullRequestUsageRead(): Promise<never> {
    return this.unused();
  }

  githubWebBase(): string {
    throw new Error("unused coding agent capability");
  }

  findOrganizationForProject(): Promise<never> {
    return this.unused();
  }

  getPullRequestUsage(): Promise<never> {
    return this.unused();
  }

  getOrganizationPullRequestUsage(): Promise<never> {
    return this.unused();
  }

  getPullRequestDetail(): Promise<never> {
    return this.unused();
  }

  getPersonalProjectPullRequestUsage(): Promise<never> {
    return this.unused();
  }

  githubConnection(): Promise<never> {
    return this.unused();
  }
}
