/**
 * The Scenario Agent Connector: an HTTP agent's setup and teardown as code LangWatch stores and
 * runs in the code runner (ADR-194).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The languages the code runner offers on main; JavaScript and TypeScript wait on ADR-183. */
export const CONNECTOR_STEP_LANGUAGES = ["python"] as const;
export type ConnectorStepLanguage = (typeof CONNECTOR_STEP_LANGUAGES)[number];

/** A step's code, and its bound dataset's rows, in bytes. */
export const CONNECTOR_CODE_MAX_BYTES = 64 * 1024;
export const CONNECTOR_ROWS_MAX_BYTES = 64 * 1024;

/** The name grammar the secrets UI and the engine use. */
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const connectorStepSchemaDefinition = z.object({
  language: z.enum(CONNECTOR_STEP_LANGUAGES),
  code: z
    .string()
    .min(1, "A Connector step needs code.")
    .refine(
      (code) => new TextEncoder().encode(code).byteLength <= CONNECTOR_CODE_MAX_BYTES,
      `A Connector step's code is at most ${CONNECTOR_CODE_MAX_BYTES / 1024} KiB.`,
    ),
  /** The project secrets this step may read; nothing else travels to it. */
  secretNames: z
    .array(z.string().regex(SECRET_NAME, "A secret name is letters, digits and underscores."))
    .default([]),
  /** Fixture rows the step receives as `rows`. */
  datasetId: z.string().min(1).optional(),
});
export interface ConnectorStepSchema extends Named<typeof connectorStepSchemaDefinition> {}
export const connectorStepSchema: ConnectorStepSchema = connectorStepSchemaDefinition;
export type ConnectorStep = z.infer<typeof connectorStepSchema>;

const connectorSchemaDefinition = z.object({
  setup: connectorStepSchema.optional(),
  teardown: connectorStepSchema.optional(),
});
export interface ConnectorSchema extends Named<typeof connectorSchemaDefinition> {}
export const connectorSchema: ConnectorSchema = connectorSchemaDefinition;
export type Connector = z.infer<typeof connectorSchema>;
