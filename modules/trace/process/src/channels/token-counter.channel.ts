/** How many tokens a model would charge for a piece of text. Undefined is the
 * deliberate "cannot count" answer, not an error; spans without usage stay as
 * they arrived, not stamped with a guess. */
export interface TraceTokenCounter {
  computeTokenCount(model: string, text: string | undefined): Promise<number | undefined>;
  close(): Promise<void>;
}
