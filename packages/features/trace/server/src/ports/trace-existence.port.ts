/**
 * Which of a set of candidate ids the project actually holds a trace for.
 *
 * The one question other verticals ask of trace storage without wanting a
 * trace: queueing for annotation and the automation that hands traces over
 * both need to know an id addresses something before they write a row against
 * it, and neither of them may reach into trace storage to find out.
 */
export abstract class TraceExistencePort {
  abstract findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]>;
}
