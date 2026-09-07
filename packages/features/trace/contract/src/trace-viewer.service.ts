import type { Trace } from "./trace-format.schemas.ts";

/** Full trace content for a named viewer read, after the viewer's protections apply. */
export type TraceViewerReadInput = Readonly<{
  projectId: string;
  userId: string;
  traceIds: readonly string[];
}>;

/** The Trace-owned viewer read used by browser and review surfaces. */
export abstract class TraceViewerService {
  abstract readForViewer(input: TraceViewerReadInput): Promise<Trace[]>;
}
