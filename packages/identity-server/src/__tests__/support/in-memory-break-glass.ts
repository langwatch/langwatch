import type { BreakGlassBinding } from "@langwatch/identity";
import type {
  SsoBreakGlassRepository,
  SsoBreakGlassWarningNotifier,
} from "../../break-glass.repository";

/**
 * The ways back in, in memory, with the same immutability the Postgres one
 * has: a grant and a renewal both insert, and the only writes to an existing
 * row are `supersededAt` and `warnedDays`. A double that let a row be edited
 * would hide the whole point of the design.
 */
export class InMemoryBreakGlassBindings implements SsoBreakGlassRepository {
  readonly rows = new Map<string, BreakGlassBinding>();

  async findAllForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    return [...this.rows.values()]
      .filter((row) => row.organizationId === organizationId)
      .sort((left, right) => left.grantedAtMs - right.grantedAtMs);
  }

  async findById({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<BreakGlassBinding | null> {
    return this.rows.get(bindingId) ?? null;
  }

  async create({ binding }: { binding: BreakGlassBinding }): Promise<void> {
    this.rows.set(binding.bindingId, { ...binding });
  }

  async markSuperseded({
    bindingId,
    supersededAtMs,
  }: {
    bindingId: string;
    supersededAtMs: number;
  }): Promise<void> {
    const held = this.rows.get(bindingId);
    if (held) this.rows.set(bindingId, { ...held, supersededAtMs });
  }

  async recordWarningsSent({
    bindingId,
    days,
  }: {
    bindingId: string;
    days: number[];
  }): Promise<void> {
    const held = this.rows.get(bindingId);
    if (held) {
      this.rows.set(bindingId, {
        ...held,
        warnedDays: [...held.warnedDays, ...days],
      });
    }
  }

  async findLiveExpiringBefore({
    beforeMs,
    nowMs,
    limit,
  }: {
    beforeMs: number;
    nowMs: number;
    limit: number;
  }): Promise<BreakGlassBinding[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.supersededAtMs === null &&
          row.expiresAtMs > nowMs &&
          row.expiresAtMs <= beforeMs,
      )
      .sort((left, right) => left.expiresAtMs - right.expiresAtMs)
      .slice(0, limit);
  }
}

/** Every warning that was sent, and what it said. */
export class CollectingBreakGlassNotifier
  implements SsoBreakGlassWarningNotifier
{
  readonly warnings: {
    userId: string;
    expiresAtMs: number;
    daysRemaining: number;
  }[] = [];

  async warn({
    binding,
    daysRemaining,
  }: Parameters<SsoBreakGlassWarningNotifier["warn"]>[0]): Promise<void> {
    this.warnings.push({
      userId: binding.userId,
      expiresAtMs: binding.expiresAtMs,
      daysRemaining,
    });
  }
}
