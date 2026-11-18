/**
 * ADR-202 rollout step 3: re-runs a sampled reader read as `SELECT count()` on an identity whose
 * profile pins enforcement on, reporting by table when the policy would hide rows. Detached: it
 * never delays, fails or alters the read. Spec: specs/clickhouse/app-reader-identity.feature
 */
import type { QueryDriver, QueryRequest } from "../query.ts";

/** A sampled read whose enforced count differs from the rows the shadow reader returned. */
export interface ShadowDivergence {
  readonly table: string;
  readonly returned: number;
  readonly enforced: number;
}

export interface ShadowSamplerOptions {
  /** The enforcing reader: the app reader's policies with enforcement pinned on. */
  driver: QueryDriver;
  /** Share of reader reads re-run, from 0 (none) to 1 (every one). */
  rate: number;
  onDivergence: (divergence: ShadowDivergence) => void;
  /** A re-run that failed or was refused; the sampled read is unaffected. */
  onFailure: (failure: { table: string; error: unknown }) => void;
  random?: (() => number) | undefined;
}

const UNNAMED_TABLE = "unknown";

export class ShadowSampler {
  private readonly driver: QueryDriver;
  private readonly rate: number;
  private readonly onDivergence: ShadowSamplerOptions["onDivergence"];
  private readonly onFailure: ShadowSamplerOptions["onFailure"];
  private readonly random: () => number;
  /** One re-run at a time: a sample arriving while one runs is skipped, bounding the extra load. */
  private running = false;

  constructor({ driver, rate, onDivergence, onFailure, random }: ShadowSamplerOptions) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new RangeError(`The shadow sample rate must be between 0 and 1, not ${rate}.`);
    }
    this.driver = driver;
    this.rate = rate;
    this.onDivergence = onDivergence;
    this.onFailure = onFailure;
    this.random = random ?? Math.random;
  }

  /** Samples one read the reader answered; the re-run's settlement, or none when not sampled. */
  observe({
    request,
    returned,
  }: {
    request: QueryRequest;
    returned: number;
  }): Promise<void> | undefined {
    if (this.running || this.random() >= this.rate) return undefined;
    this.running = true;
    return this.rerun({ request, returned }).finally(() => {
      this.running = false;
    });
  }

  private async rerun({
    request,
    returned,
  }: {
    request: QueryRequest;
    returned: number;
  }): Promise<void> {
    const table = request.table ?? UNNAMED_TABLE;
    try {
      const { rows } = await this.driver.execute<{ enforced: string | number }>({
        ...request,
        sql: `SELECT count() AS enforced FROM (${withoutTrailingSemicolons(request.sql.trim())})`,
        signal: undefined,
      });
      const enforced = Number(rows[0]?.enforced ?? 0);
      if (enforced !== returned) this.onDivergence({ table, returned, enforced });
    } catch (error) {
      this.onFailure({ table, error });
    }
  }
}

/** `sql` without its trailing semicolons, in one pass: `/;+$/` is quadratic on a long `;` run. */
function withoutTrailingSemicolons(sql: string): string {
  let end = sql.length;
  while (end > 0 && sql[end - 1] === ";") end -= 1;
  return sql.slice(0, end);
}
