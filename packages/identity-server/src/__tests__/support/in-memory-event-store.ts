import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity";
import type { IdentityLedger } from "../../identity-ledger";
import { type InMemoryHeads, T0 } from "./in-memory-heads";

/**
 * The event store, in memory, WITH its idempotency contract.
 *
 * Every fact a command emits is keyed `<commandId>:<index>` — the framework's
 * convention, stamped by the app's identity envelope and honoured by the
 * ClickHouse store. A retried command therefore re-states facts the store
 * already holds, and the store absorbs them: the caller is handed the rows
 * that landed the first time, and nothing is written twice.
 *
 * That is not decoration on a double. It is the ONLY reason a retried
 * born-finalized sign-up converges on one identifier: the identifier id is
 * derived from `(user, provider, subject, value, occurredAt)` and `occurredAt`
 * is the row's own `createdAt`, so a retry a second later legitimately derives
 * a DIFFERENT identifier id. What makes the two the same fact is the command
 * id, which the entrance pins. A double that appended whatever it was handed
 * showed two identifiers whenever the two attempts straddled a second
 * boundary — a suite failing on the clock, for a convergence production has.
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
 * what landed into the heads. What the app's pipeline does once ClickHouse
 * holds the append and the projection catches up.
 *
 * `commands` records every command DISPATCHED, deduped or not — the command
 * really did run, and the absorption happens at the store, exactly where it
 * happens in production.
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
