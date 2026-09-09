/**
 * Who a saved LangWatchQL chart is admitted and executed for. Both answers
 * need the deployment's own secret, which must not leave the process, so
 * Dashboard states the question here and the process answers it.
 */
import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";

export abstract class WorkbenchCallerPort {
  /** The member's own content protections for this project. */
  abstract resolveProtections(input: {
    actorId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections>;

  /** The project identity and protections a session-authenticated run uses. */
  abstract resolveRunCaller(input: {
    actorId: string;
    projectId: string;
  }): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
}
