export interface CodingAgentTraceSessionCandidate {
  sessionId: string;
  startedAtMs: number;
  repositoryHost: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  gitBranch: string | null;
}

export interface CodingAgentTracePullRequestLink {
  sessionId: string;
  pullRequest: {
    number: number;
    htmlUrl: string;
    title: string;
  };
}

export interface CodingAgentTracePullRequestInput {
  organizationId: string;
  sessions: readonly CodingAgentTraceSessionCandidate[];
}
