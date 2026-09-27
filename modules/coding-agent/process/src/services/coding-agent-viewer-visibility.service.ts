import type { TraceApi } from "@langwatch/trace-contract";

import type {
  CodingAgentViewerVisibility,
  CodingAgentViewerVisibilityReader,
} from "../app/coding-agent.members.ts";

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
