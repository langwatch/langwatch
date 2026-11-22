import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity-contract";

import type { IdentityLedger } from "../../rules/identity-ledger.rules.ts";
import { type InMemoryHeads, T0 } from "./in-memory-heads.ts";

/**
 * The event store, in memory, WITH its idempotency contract: facts are keyed
 * `<commandId>:<index>`, so a retry absorbs rather than writes twice — the
 * only reason a restated attach converges on one identifier.
 */
export class InMemoryIdentityEventStore {
  /** `<commandId>:<index>` → the fact that landed under it. */
  readonly rows = new Map<string, IdentityFact>();

  /**
   * Append one command's facts. Answers both what the store now HOLDS for
   * this command — originals where a key was already taken — and only the
   * facts that actually LANDED, which is what a projection has to fold.
   */
  append({
    commandId,
    facts,
    occurredAt = T0,
  }: {
    commandId: string;
    facts: readonly IdentityFactInput[];
    occurredAt?: number;
  }): { stored: IdentityFact[]; landed: IdentityFact[] } {
    const stored: IdentityFact[] = [];
    const landed: IdentityFact[] = [];
    facts.forEach((fact, index) => {
      const key = `${commandId}:${index}`;
      const held = this.rows.get(key);
      if (held) {
        stored.push(held);
        return;
      }
      const row = { ...fact, occurredAt } as IdentityFact;
      this.rows.set(key, row);
      stored.push(row);
      landed.push(row);
    });
    return { stored, landed };
  }
}

/**
 * The ledger every in-memory stack runs on: append through the store, fold
 * what landed into the heads. `commands` records every DISPATCH, deduped or
 * not — absorption happens at the store, exactly as in production.
 */
export function inMemoryIdentityLedger({
  heads,
  events,
  commands,
  refuse,
}: {
  heads: InMemoryHeads;
  events: InMemoryIdentityEventStore;
  commands: IdentityCommand[];
  /** The engine as a ceremony finds it: a reason to refuse, or nothing. */
  refuse?: () => string | null;
}): IdentityLedger {
  return {
    async commit({
      command,
      facts,
    }: {
      command: IdentityCommand;
      facts: IdentityFactInput[];
    }): Promise<IdentityFact[]> {
      const refusal = refuse?.() ?? null;
      if (refusal !== null) throw new Error(refusal);
      commands.push(command);
      const { stored, landed } = events.append({
        commandId: command.data.commandId,
        facts,
      });
      if (landed.length > 0) heads.fold(command.data.userId, landed, T0);
      return stored;
    },
  };
}
