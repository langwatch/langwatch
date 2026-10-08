import type { ServingRosterEntry } from "../../ledger.ts";
import type { ServingRosterDeclaration, ServingRosterLedger } from "../serving-roster-ledger.ts";

/**
 * The serving roster table in memory, as `UpgradeLedgerRepository` keeps it: the store's clock
 * stamps both times, a refresh keeps `startedAt`, and a row exactly `staleAfterMs` old is live.
 */
export class MemoryServingRosterLedger implements ServingRosterLedger {
  readonly rows = new Map<string, ServingRosterEntry>();
  private writesToRefuse = 0;
  private removesRefused = false;
  private prunesRefused = false;
  private held: Promise<void> | null = null;

  refuseNextWrite(): void {
    this.writesToRefuse += 1;
  }

  refuseRemoves(): void {
    this.removesRefused = true;
  }

  refusePrunes(): void {
    this.prunesRefused = true;
  }

  /** Writes wait until the returned function is called. */
  holdWrites(): () => void {
    let release = (): void => undefined;
    this.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.held = null;
      release();
    };
  }

  async writeRosterEntry(declaration: ServingRosterDeclaration): Promise<ServingRosterEntry> {
    if (this.held) await this.held;
    if (this.writesToRefuse > 0) {
      this.writesToRefuse -= 1;
      throw new Error("roster write refused");
    }
    const now = new Date();
    const row: ServingRosterEntry = {
      ...declaration,
      steps: [...declaration.steps],
      startedAt: this.rows.get(declaration.processId)?.startedAt ?? now,
      heartbeatAt: now,
    };
    this.rows.set(row.processId, row);
    return row;
  }

  async findLiveRoster({ staleAfterMs }: { staleAfterMs: number }): Promise<ServingRosterEntry[]> {
    const now = Date.now();
    return [...this.rows.values()]
      .filter((row) => row.heartbeatAt.getTime() >= now - staleAfterMs)
      .toSorted((a, b) => a.processId.localeCompare(b.processId));
  }

  async removeRosterEntry({ processId }: { processId: string }): Promise<void> {
    if (this.removesRefused) throw new Error("roster delete refused");
    this.rows.delete(processId);
  }

  async pruneRoster({ deadForMs }: { deadForMs: number }): Promise<number> {
    if (this.prunesRefused) throw new Error("roster prune refused");
    const dead = [...this.rows.values()].filter(
      (row) => row.heartbeatAt.getTime() < Date.now() - deadForMs,
    );
    for (const row of dead) this.rows.delete(row.processId);
    return dead.length;
  }
}
