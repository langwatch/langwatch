/**
 * The two database rows these screens read, declared where they are read.
 *
 * `~/generated/prisma/client` is the application's generated client and cannot
 * be imported from a feature-web package — the module does not exist until
 * `prisma generate` has run against the application's schema, and a package
 * that named it would make its own typecheck depend on that. The model-config
 * and workflow families answered this the same way: state the ROW as the
 * screens read it, keep the field names and nullability exactly as the schema
 * declares them, and let the day a contract package publishes them retire this
 * file.
 *
 * KEPT IN STEP BY HAND, and that obligation is the price of the move — the same
 * one `@langwatch/enterprise-billing-contract` states about its Prisma enum
 * copies. Both models are in `packages/prisma-client/prisma/schema.prisma`.
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
  folderId: string | null;
  version: number;
  lastUpdatedById: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A run plan or a folder — `kind` is which. */
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
