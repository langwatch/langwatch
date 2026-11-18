/** Whether the LangWatchQL server holds an access model, as the last probe found it. */
export type LangWatchQLAccessModelAnswer = "provisioned" | "not_provisioned";

/**
 * How long a stored answer stands: three 5-minute reconvergence checks, each of which stores it
 * anew, so it lapses only once two checks in a row failed to answer (ADR-202 Decided 3).
 */
export const LWQL_ACCESS_MODEL_ANSWER_TTL_MS = 15 * 60_000;

/**
 * The worker's last probe answer per LangWatchQL server origin, shared by the fleet; the
 * placement gate only reads it (ADR-200). One server's answer never stands for another's. A
 * store failure throws.
 * @see modules/analytics/specs/analytics-lwql-access-model-answer.feature
 */
export abstract class LangWatchQLAccessModelAnswerRepository {
  /** The answer still held for `origin`, or null once it expired or none was recorded. */
  abstract findAnswer(input: { origin: string }): Promise<LangWatchQLAccessModelAnswer | null>;
  abstract recordAnswer(input: {
    origin: string;
    answer: LangWatchQLAccessModelAnswer;
  }): Promise<void>;
}
