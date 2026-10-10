/**
 * Offline experiments for the dashboards demo, sent as the SDK's batch evaluation sends them:
 * a weekly run over a fixed dataset. The shop assistant compares its two models; the invoice
 * classifier scores field precision and recall, which improve after its rules change.
 */
import type { DemoDay } from "./dashboards-demo-days.ts";
import { DemoRandom } from "./dashboards-demo-random.ts";

interface DemoTarget {
  id: string;
  name: string;
  model: string;
  /** Chance a row passes and its usual score, by prototype day. */
  quality: (day: number) => number;
  costPerRow: number;
}

interface DemoExperiment {
  agent: string;
  slug: string;
  name: string;
  rows: number;
  targets: DemoTarget[];
  /** Names of the evaluators every row gets; a scored one passes at 0.7 or above. */
  evaluators: string[];
}

export const DEMO_EXPERIMENTS: readonly DemoExperiment[] = [
  {
    agent: "shop-assistant",
    slug: "shop-assistant-golden-set",
    name: "Shop assistant golden set",
    rows: 24,
    targets: [
      {
        id: "gpt-5-mini",
        name: "gpt-5-mini",
        model: "openai/gpt-5-mini",
        quality: () => 0.86,
        costPerRow: 0.0021,
      },
      {
        id: "gpt-5-nano",
        name: "gpt-5-nano",
        model: "openai/gpt-5-nano",
        quality: () => 0.71,
        costPerRow: 0.0004,
      },
    ],
    evaluators: ["Answer quality"],
  },
  {
    agent: "invoice-classifier",
    slug: "invoice-field-accuracy",
    name: "Invoice field accuracy",
    rows: 30,
    targets: [
      {
        id: "extractor",
        name: "invoice extractor",
        model: "anthropic/claude-sonnet-4-5",
        quality: (day) => (day >= 76 ? 0.93 : 0.84),
        costPerRow: 0.018,
      },
    ],
    evaluators: ["Field precision", "Field recall"],
  },
];

/** One run's results body; its id lets a re-run leave out a run the project already holds. */
export type DemoExperimentRun = { run_id: string } & Record<string, unknown>;

/** The experiment's run that week, on Mondays only; its id is fixed by the date. */
export function experimentRunOn({
  experiment,
  day,
  now,
}: {
  experiment: DemoExperiment;
  day: DemoDay;
  /** A run that would still be going at this moment is left out. */
  now: number;
}): DemoExperimentRun | undefined {
  if (day.weekday !== 1 || day.dayStart + 11 * 3_600_000 > now) return undefined;
  const runId = `run_${experiment.slug}_${day.key}`;
  const random = new DemoRandom(runId);
  const createdAt = day.dayStart + 9 * 3_600_000 + random.int({ min: 0, max: 3_600_000 });
  const dataset = [];
  const evaluations = [];
  for (const target of experiment.targets) {
    for (let index = 0; index < experiment.rows; index++) {
      const passed = random.chance(target.quality(day.prototypeDay));
      dataset.push({
        index,
        target_id: target.id,
        entry: { question: `Golden question ${index + 1}` },
        predicted: { answer: passed ? "A correct, complete answer." : "A partial answer." },
        cost: target.costPerRow * (0.6 + random.next() * 0.8),
        duration: Math.round(random.logNormal({ median: 1_800, p95: 6_000 })),
      });
      for (const evaluator of experiment.evaluators) {
        const score = passed ? 0.7 + random.next() * 0.3 : 0.2 + random.next() * 0.45;
        evaluations.push({
          evaluator: evaluator.toLowerCase().replace(/\s+/g, "-"),
          name: evaluator,
          target_id: target.id,
          status: "processed",
          index,
          score: Math.round(score * 1000) / 1000,
          passed: score >= 0.7,
        });
      }
    }
  }
  return {
    experiment_slug: experiment.slug,
    name: experiment.name,
    run_id: runId,
    progress: dataset.length,
    total: dataset.length,
    targets: experiment.targets.map(({ id, name, model }) => ({ id, name, model, type: "prompt" })),
    dataset,
    evaluations,
    timestamps: { created_at: createdAt, finished_at: createdAt + 6 * 60_000 },
  };
}
