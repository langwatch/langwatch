import type { UpgradePresence } from "../../ledger.ts";
import type { PresenceDeclaration, PresenceLedger } from "../presence-ledger.ts";

/**
 * The presence table in memory, as `UpgradeLedgerRepository` keeps it: the store's clock
 * stamps both times, a refresh keeps `startedAt`, and a row exactly `staleAfterMs` old is live.
 */
export class MemoryPresenceLedger implements PresenceLedger {
  readonly rows = new Map<string, UpgradePresence>();
  private writesToRefuse = 0;
  private removesRefused = false;
  private held: Promise<void> | null = null;

  refuseNextWrite(): void {
    this.writesToRefuse += 1;
  }

  refuseRemoves(): void {
    this.removesRefused = true;
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

  async writePresence(declaration: PresenceDeclaration): Promise<UpgradePresence> {
    if (this.held) await this.held;
    if (this.writesToRefuse > 0) {
      this.writesToRefuse -= 1;
      throw new Error("presence write refused");
    }
    const now = new Date();
    const row: UpgradePresence = {
      ...declaration,
      steps: [...declaration.steps],
      startedAt: this.rows.get(declaration.processId)?.startedAt ?? now,
      heartbeatAt: now,
    };
    this.rows.set(row.processId, row);
    return row;
  }

  async findLivePresence({ staleAfterMs }: { staleAfterMs: number }): Promise<UpgradePresence[]> {
    const now = Date.now();
    return [...this.rows.values()]
      .filter((row) => row.heartbeatAt.getTime() >= now - staleAfterMs)
      .toSorted((a, b) => a.processId.localeCompare(b.processId));
  }

  async removePresence({ processId }: { processId: string }): Promise<void> {
    if (this.removesRefused) throw new Error("presence delete refused");
    this.rows.delete(processId);
  }
}
