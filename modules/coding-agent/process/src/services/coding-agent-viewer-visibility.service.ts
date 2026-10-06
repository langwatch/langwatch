import type { TraceApi } from "@langwatch/trace-contract";

/** What one viewer may see of one project: the generated titles travel under content visibility. */
export type CodingAgentViewerVisibility = Readonly<{
  canReadCapturedContent: boolean;
  canSeeCosts: boolean;
}>;

/** Resolves one viewer's protections over one project; throws when unresolvable. */
export interface CodingAgentViewerVisibilityReader {
  readVisibility(input: {
    userId: string;
    projectId: string;
  }): Promise<CodingAgentViewerVisibility>;
}

/** The same protections the trace surfaces read through, so a session list and its traces agree. */
export class CodingAgentViewerVisibilityService implements CodingAgentViewerVisibilityReader {
  static create(peers: {
    traces: Pick<TraceApi, "resolveViewerProtections">;
  }): CodingAgentViewerVisibilityService {
    return new CodingAgentViewerVisibilityService(peers.traces);
  }

  private constructor(private readonly traces: Pick<TraceApi, "resolveViewerProtections">) {}

  async readVisibility(input: {
    userId: string;
    projectId: string;
  }): Promise<CodingAgentViewerVisibility> {
    const protections = await this.traces.resolveViewerProtections(input);

    return {
      canReadCapturedContent:
        protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true,
      canSeeCosts: protections.canSeeCosts === true,
    };
  }
}
