/**
 * A run of text the takeover's typewriter types out, letter by letter, with
 * an optional pause once it lands. Framework-free so `copy.ts` (also model)
 * builds segments without reaching into `ui/`.
 */
export interface TypeSegment {
  text: string;
  /** ms to hold after this segment before the next one types */
  pauseAfter?: number;
}
