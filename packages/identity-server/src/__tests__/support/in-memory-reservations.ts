import type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "../../identity-reservations.repository";

/**
 * The address lock, in memory (ADR-116 §6).
 *
 * A `Map` insert is atomic here for the same reason the Postgres primary key
 * is atomic there: the first writer wins and every later one reads the
 * winner's row back. That is the whole contract, so a suite driving the guards
 * over this exercises the real decision rather than a stub that always says
 * yes.
 */
export class InMemoryReservations implements IdentityReservationRepository {
  readonly held = new Map<string, IdentifierReservationHolder>();

  async claim({
    normalizedValue,
    userId,
    identifierId,
    commandId,
  }: {
    normalizedValue: string;
    userId: string;
    identifierId: string;
    commandId: string;
  }): Promise<IdentifierReservationHolder> {
    const existing = this.held.get(normalizedValue);
    if (existing) return existing;
    const claim = { normalizedValue, userId, identifierId, commandId };
    this.held.set(normalizedValue, claim);
    return claim;
  }

  async release({
    userId,
    holdingIdentifierIds,
  }: {
    userId: string;
    holdingIdentifierIds: readonly string[];
  }): Promise<number> {
    let released = 0;
    for (const [value, claim] of [...this.held]) {
      if (claim.userId !== userId) continue;
      if (holdingIdentifierIds.includes(claim.identifierId)) continue;
      this.held.delete(value);
      released += 1;
    }
    return released;
  }

  async reapOrphans(): Promise<number> {
    return 0;
  }
}
