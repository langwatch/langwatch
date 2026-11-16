/** Whether the LangWatchQL server holds an access model, as the last probe found it. */
export type LangWatchQLAccessModelAnswer = "provisioned" | "not_provisioned";

/** How long the gate may answer from a stale probe: a newly provisioned server waits this long. */
export const LWQL_ACCESS_MODEL_ANSWER_TTL_MS = 5 * 60_000;

/**
 * The placement gate's last probe answer per LangWatchQL server origin, shared by the fleet and
 * kept for a bounded time, so a newly provisioned server is answered within it (ADR-200). One
 * server's answer never stands for another's. A store failure throws.
 * @see specs/lwql/isolation.feature
 */
export abstract class LangWatchQLAccessModelAnswerRepository {
  /** The answer still held for `origin`, or null once it expired or none was recorded. */
  abstract findAnswer(input: { origin: string }): Promise<LangWatchQLAccessModelAnswer | null>;
  abstract recordAnswer(input: {
    origin: string;
    answer: LangWatchQLAccessModelAnswer;
  }): Promise<void>;
}
