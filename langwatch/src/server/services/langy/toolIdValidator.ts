/**
 * Conversation-scoped ID set tracker for Langy tool calls.
 *
 * Tools that LIST or DETAIL entities (evaluators, prompts, datasets) record
 * the IDs/slugs they returned. Tools that ACT on a specific id/slug check it
 * was previously seen — preventing the LLM from referencing fabricated IDs.
 */

export type SeenIdKind =
  | "evaluator_id"
  | "evaluator_slug"
  | "evaluator_type"
  | "prompt_id"
  | "prompt_handle"
  | "dataset_id";

export class ConversationToolIdSet {
  private readonly seen = new Map<SeenIdKind, Set<string>>();

  record(kind: SeenIdKind, id: string | undefined | null) {
    if (!id) return;
    let set = this.seen.get(kind);
    if (!set) {
      set = new Set();
      this.seen.set(kind, set);
    }
    set.add(String(id));
  }

  recordMany(kind: SeenIdKind, ids: Array<string | undefined | null>) {
    for (const id of ids) this.record(kind, id);
  }

  has(kind: SeenIdKind, id: string | undefined | null): boolean {
    if (!id) return false;
    return this.seen.get(kind)?.has(String(id)) ?? false;
  }

  /**
   * Returns true if any of the kinds contain the given id.
   * Useful for slugs/handles that may have been recorded under multiple kinds.
   */
  hasAny(kinds: SeenIdKind[], id: string | undefined | null): boolean {
    return kinds.some((k) => this.has(k, id));
  }
}
