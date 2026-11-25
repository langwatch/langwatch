import { z } from "zod";

/** The phases a run moves through; schema phases repeat per release (round 9, U2-PHASES). */
export const upgradePhaseNameSchema = z.enum([
  "preflight",
  "postgres-schema",
  "clickhouse-schema",
  "reconcile",
]);
export type UpgradePhaseName = z.infer<typeof upgradePhaseNameSchema>;

export const upgradePhaseOutcomeSchema = z.enum(["running", "succeeded", "failed"]);
export type UpgradePhaseOutcome = z.infer<typeof upgradePhaseOutcomeSchema>;

/** One entry of a run report's `phases`, as the runner writes it; instants are ISO 8601 UTC. */
export const upgradeRunPhaseSchema = z.object({
  name: upgradePhaseNameSchema,
  release: z.string().nullable().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  outcome: upgradePhaseOutcomeSchema,
});
export type UpgradeRunPhase = z.infer<typeof upgradeRunPhaseSchema>;

/** What changed: the run, the phase that moved, and every phase so far. */
export type UpgradePhaseChange = Readonly<{
  runId: string;
  phase: UpgradeRunPhase;
  phases: readonly UpgradeRunPhase[];
}>;

/** The phases of one run, in the order they started; every change is handed to `onChange`. */
export class RunPhases {
  private readonly phases: UpgradeRunPhase[] = [];
  private readonly runId: string;
  private readonly onChange: (change: UpgradePhaseChange) => Promise<void>;
  private readonly now: () => Promise<string>;

  /** `now` answers the database clock as ISO 8601 UTC, the ledger's one clock (ADR-173 3). */
  constructor({
    runId,
    onChange,
    now,
  }: {
    runId: string;
    onChange: (change: UpgradePhaseChange) => Promise<void>;
    now: () => Promise<string>;
  }) {
    this.runId = runId;
    this.onChange = onChange;
    this.now = now;
  }

  list(): UpgradeRunPhase[] {
    return this.phases.map((phase) => ({ ...phase }));
  }

  async start({
    name,
    release,
  }: {
    name: UpgradePhaseName;
    release?: string | null;
  }): Promise<void> {
    const phase: UpgradeRunPhase = {
      name,
      ...(release === undefined ? {} : { release }),
      startedAt: await this.now(),
      outcome: "running",
    };
    this.phases.push(phase);
    await this.changed(phase);
  }

  /** Ends the latest running phase called `name`. */
  async end({
    name,
    outcome,
  }: {
    name: UpgradePhaseName;
    outcome: Exclude<UpgradePhaseOutcome, "running">;
  }): Promise<void> {
    const phase = this.phases.findLast((each) => each.name === name && each.outcome === "running");
    if (phase) await this.close({ phase, outcome });
  }

  /** Ends every phase still running with `outcome`; a phase already ended keeps its own. */
  async finish({ outcome }: { outcome: Exclude<UpgradePhaseOutcome, "running"> }): Promise<void> {
    for (const phase of this.phases) {
      if (phase.outcome === "running") await this.close({ phase, outcome });
    }
  }

  private async close({
    phase,
    outcome,
  }: {
    phase: UpgradeRunPhase;
    outcome: Exclude<UpgradePhaseOutcome, "running">;
  }): Promise<void> {
    phase.outcome = outcome;
    phase.finishedAt = await this.now();
    await this.changed(phase);
  }

  private changed(phase: UpgradeRunPhase): Promise<void> {
    return this.onChange({ runId: this.runId, phase: { ...phase }, phases: this.list() });
  }
}
