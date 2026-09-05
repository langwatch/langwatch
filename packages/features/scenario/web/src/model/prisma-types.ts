/**
 * The two database rows these screens read, declared where they are read.
 */

/** Anything the schema types as `Json`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A scenario, as the library table and the case editor read it. */
export type Scenario = {
  id: string;
  projectId: string;
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
  /** `{ name, description?, defaultValue?, secret? }[]`, or null for none. */
  parameters: JsonValue | null;
  simulatorModel: string | null;
  judgeModel: string | null;
  maxTurns: number | null;
  minTurns: number | null;
  testSuiteId: string | null;
  version: number;
  lastUpdatedById: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A run plan or a test suite — `kind` is which. */
export type SimulationSuite = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  scenarioIds: string[];
  /** `{ type: "prompt" | "http", referenceId: string }[]`. */
  targets: JsonValue;
  repeatCount: number;
  labels: string[];
  simulatorModel: string | null;
  judgeModel: string | null;
  /** `"folder"` or `"custom"`. */
  kind: string;
  /** `{ mode }` plus the mode's own field, or null, which reads as `"cases"`. */
  scope: JsonValue | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
