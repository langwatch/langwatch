import type {
  GatewayBudget,
  GatewayDecimal,
  GatewayVirtualKeyRecord,
} from "@langwatch/gateway-contract";

/** A group as the memory directory holds it; the organization module owns the real rows. */
export type MemoryGatewayGroup = { id: string; organizationId: string; name: string };

/** A model provider's label source, as another module's row would answer it. */
export type MemoryGatewayModelProvider = { id: string; name: string; provider: string };

type Tables = {
  budgets: Map<string, GatewayBudget>;
  virtualKeys: Map<string, GatewayVirtualKeyRecord>;
};

/**
 * The rows several gateway twins share, the way one Postgres connection
 * serves them: a budget a key's drawer writes is the budget every budget read
 * answers from. Rows are replaced, never mutated, so a transaction can restore.
 */
export class MemoryGatewayStore {
  static create(
    seed: Readonly<{
      groups?: readonly MemoryGatewayGroup[];
      groupMemberships?: readonly { groupId: string; userId: string }[];
      modelProviders?: readonly MemoryGatewayModelProvider[];
    }> = {},
  ): MemoryGatewayStore {
    return new MemoryGatewayStore(seed);
  }

  budgets = new Map<string, GatewayBudget>();
  virtualKeys = new Map<string, GatewayVirtualKeyRecord>();
  readonly groups: readonly MemoryGatewayGroup[];
  readonly groupMemberships: readonly { groupId: string; userId: string }[];
  readonly modelProviders: readonly MemoryGatewayModelProvider[];
  #nextId = 0;

  private constructor(
    seed: Readonly<{
      groups?: readonly MemoryGatewayGroup[];
      groupMemberships?: readonly { groupId: string; userId: string }[];
      modelProviders?: readonly MemoryGatewayModelProvider[];
    }>,
  ) {
    this.groups = seed.groups ?? [];
    this.groupMemberships = seed.groupMemberships ?? [];
    this.modelProviders = seed.modelProviders ?? [];
  }

  /** A fresh row id, unique within this store. */
  newId(prefix: string): string {
    this.#nextId += 1;
    return `${prefix}_${this.#nextId.toString().padStart(8, "0")}`;
  }

  /** Runs `work` over the tables; a throw restores them as they were. */
  async atomically<T>(work: () => Promise<T>): Promise<T> {
    const before: Tables = {
      budgets: new Map(this.budgets),
      virtualKeys: new Map(this.virtualKeys),
    };
    try {
      return await work();
    } catch (error) {
      this.budgets = before.budgets;
      this.virtualKeys = before.virtualKeys;
      throw error;
    }
  }
}

/** A `Decimal(18, 6)` money value from its decimal string, rounded to six places as stored. */
export function memoryGatewayDecimal(value: string): GatewayDecimal {
  const negative = value.trim().startsWith("-");
  const [whole = "0", fraction = ""] = value.trim().replace(/^[-+]/, "").split(".");
  const sevenths = BigInt(whole || "0") * 10_000_000n + BigInt(fraction.padEnd(7, "0").slice(0, 7));
  const micros = (sevenths + 5n) / 10n;
  const render = (places: number): string => {
    const unit = 10n ** BigInt(6 - places);
    const rounded = (micros + unit / 2n) / unit;
    const text = rounded.toString().padStart(places + 1, "0");
    const sign = negative && rounded !== 0n ? "-" : "";
    return places === 0
      ? `${sign}${text}`
      : `${sign}${text.slice(0, -places)}.${text.slice(-places)}`;
  };

  return {
    toString: () => render(6).replace(/\.?0+$/, ""),
    toFixed: (digits = 0) => render(Math.min(Math.max(digits, 0), 6)),
  };
}
