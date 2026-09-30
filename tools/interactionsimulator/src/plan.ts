import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "js-yaml";
import { z } from "zod";

import type { Ledger } from "./ledger";
import { askSonnet, type SonnetConfig } from "./sonnet";

const catalogueSchema = z.object({
  features: z.array(z.object({ id: z.string(), root: z.string() })),
});

const visualdiffSchema = z.object({
  routes: z.array(z.string()).default([]),
  settle: z.object({ quietMillis: z.number(), deadlineMillis: z.number() }),
});

export interface Feature {
  id: string;
  root: string;
}

/** features reads modules/catalogue.json, the one map of what the product has. */
export const features = ({ root }: { root: string }): Feature[] =>
  catalogueSchema.parse(JSON.parse(readFileSync(join(root, "modules", "catalogue.json"), "utf8")))
    .features;

/** pickFeatures finds each named feature by its catalogue id, its plural being accepted too. */
export const pickFeatures = ({ all, names }: { all: Feature[]; names: string[] }): Feature[] =>
  names.map((name) => {
    const feature = all.find((candidate) => candidate.id === name || `${candidate.id}s` === name);
    if (feature === undefined) {
      throw new Error(
        `no feature "${name}" in modules/catalogue.json (known: ${all.map((f) => f.id).join(", ")})`,
      );
    }
    return feature;
  });

/** visualdiffConfig is the route list and settle the UI exposes, read from visualdiff.yaml. */
export const visualdiffConfig = ({ root }: { root: string }): z.infer<typeof visualdiffSchema> =>
  visualdiffSchema.parse(
    load(readFileSync(join(root, "tools", "visualdiff", "visualdiff.yaml"), "utf8")),
  );

/** scenarios are what a user does with a feature: the titles in its module and product specs. */
export const scenarios = ({ root, feature }: { root: string; feature: Feature }): string[] => {
  const dirs = [
    join(root, feature.root, "specs"),
    join(root, "specs", feature.id),
    join(root, "specs", `${feature.id}s`),
  ];
  return dirs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".feature"))
        .map((name) => join(dir, name)),
    )
    .flatMap((file) => readFileSync(file, "utf8").split("\n"))
    .flatMap((line) => /^\s*(Feature|Scenario(?: Outline)?):\s*(.+)$/.exec(line)?.[0].trim() ?? [])
    .slice(0, 200);
};

export const journeySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  goal: z.string().min(1),
  start: z.string().startsWith("/"),
  steps: z.array(z.string().min(1)).min(1),
  values: z.record(z.string(), z.string()).default({}),
  proof: z.object({ path: z.string().startsWith("/"), texts: z.array(z.string().min(1)).min(1) }),
  blockedBy: z.string().optional(),
});

export type Journey = z.infer<typeof journeySchema>;

const planSchema = z.object({ journeys: z.array(journeySchema) });

export const replanSchema = z.object({
  status: z.enum(["continue", "works", "broken", "blocked"]),
  reason: z.string(),
  steps: z.array(z.string().min(1)).min(1).optional(),
  values: z.record(z.string(), z.string()).optional(),
});

export type Replan = z.infer<typeof replanSchema>;

/** parseJson reads the one JSON object a model answered, fenced or not, against its schema. */
export const parseJson = <Shape extends z.ZodType>({
  text,
  schema,
}: {
  text: string;
  schema: Shape;
}): z.infer<Shape> => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start)
    throw new Error(`no JSON object in the answer: ${text.slice(0, 200)}`);
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (thrown) {
    throw new Error(
      `the answer is not valid JSON (${String(thrown)}): ${text.slice(start, start + 200)}`,
    );
  }
  return schema.parse(value);
};

/** parseJourneys reads a plan, keeping at most `limit` journeys and each id once. */
export const parseJourneys = ({ text, limit }: { text: string; limit: number }): Journey[] => {
  const seen = new Set<string>();
  return parseJson({ text, schema: planSchema })
    .journeys.filter((journey) => !seen.has(journey.id) && seen.add(journey.id))
    .slice(0, limit);
};

const PLANNER = `You plan journeys through LangWatch, an LLM ops platform, for a browser agent that uses
the product as a real user would. A cheap classifier picks every click from the page's accessibility
tree by following your steps, so write steps a newcomer could follow by what the screen says.

Answer one JSON object and nothing else:
{"journeys": [{"id": "kebab-case", "goal": "...", "start": "/{slug}/...",
  "steps": ["Click New dataset", "Name it with the value 'name'", "Save"],
  "values": {"name": "Sim dataset {uid}"},
  "proof": {"path": "/{slug}/...", "texts": ["Sim dataset {uid}"]},
  "blockedBy": "only when it needs real third-party credentials"}]}

Rules: every journey changes something and proves it persisted: proof.path is a page to reload
and proof.texts are texts that must then be visible. Every name you create contains {uid}. Paths
use {slug} for the project. Use only the routes listed. Order journeys create before edit before
delete, each independent of the others.

Routes the UI serves:
`;

/** planJourneys asks Sonnet for a feature's journeys, from its scenarios and the served routes. */
export const planJourneys = async ({
  config,
  ledger,
  feature,
  featureScenarios,
  routes,
  limit,
}: {
  config: SonnetConfig;
  ledger: Ledger;
  feature: Feature;
  featureScenarios: string[];
  routes: string[];
  limit: number;
}): Promise<Journey[]> => {
  const text = await askSonnet({
    config,
    ledger,
    system: PLANNER + routes.join("\n"),
    prompt: `Plan up to ${limit} journeys for the feature "${feature.id}" (${feature.root}), the ones a user relies on most.\n\nWhat its specs say a user does:\n${featureScenarios.join("\n") || "(no specs)"}`,
  });
  return parseJourneys({ text, limit });
};

const REPLANNER = `You supervise a browser agent walking one journey through LangWatch. You never see
the pages: you read the log of what a classifier (jev) saw and chose at each step. Decide from it.

Answer one JSON object and nothing else:
{"status": "continue" | "works" | "broken" | "blocked", "reason": "one sentence",
 "steps": ["revised remaining steps, only with continue"], "values": {"only": "new values"}}

works: the goal was reached and the proof held. broken: the product failed the user (an error, a
save that did not persist, a dead end the product caused). blocked: it needs something the run cannot
have (real credentials, a paid plan). continue: the agent went wrong and revised steps can still
reach the goal.`;

/** replan hands Sonnet a journey's question and answer log, never a page, and reads its call. */
export const replan = async ({
  config,
  ledger,
  journey,
  steps,
  log,
  why,
}: {
  config: SonnetConfig;
  ledger: Ledger;
  journey: Journey;
  steps: string[];
  log: string[];
  why: string;
}): Promise<Replan> => {
  const text = await askSonnet({
    config,
    ledger,
    system: REPLANNER,
    prompt: [
      `Goal: ${journey.goal}`,
      `Current steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
      `Values: ${JSON.stringify(journey.values)}`,
      `Proof: reload ${journey.proof.path} and see ${JSON.stringify(journey.proof.texts)}`,
      `Log:\n${log.join("\n")}`,
      `You are asked because ${why}.`,
    ].join("\n\n"),
  });
  return parseJson({ text, schema: replanSchema });
};
