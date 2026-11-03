/**
 * The Scenario Connector agent: code blocks LangWatch stores and runs in the code runner to reach
 * the customer's own API (ADR-194).
 * @see modules/agent/specs/scenario-connector-agent.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import { baseAgentConfigSchema } from "./code.ts";

/** The languages the code runner offers for a block; JavaScript and TypeScript wait on ADR-183. */
export const CONNECTOR_BLOCK_LANGUAGES = ["python"] as const;
export type ConnectorBlockLanguage = (typeof CONNECTOR_BLOCK_LANGUAGES)[number];

/** A block's code, and the fixture rows every block receives, in bytes. */
export const CONNECTOR_BLOCK_MAX_BYTES = 64 * 1024;
export const CONNECTOR_ROWS_MAX_BYTES = 64 * 1024;

/** SECRET_NAME_PATTERN in the secret contract, which this package does not depend on. */
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

/** UTF-8 size without TextEncoder, which this isomorphic package's lib does not declare. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    bytes += 1 + Number(point >= 0x80) + Number(point >= 0x800) + Number(point >= 0x10000);
  }
  return bytes;
}

const connectorBlockSchemaDefinition = z.object({
  language: z.enum(CONNECTOR_BLOCK_LANGUAGES),
  code: z
    .string()
    .min(1, "A connector block needs code.")
    .refine(
      (code) => utf8ByteLength(code) <= CONNECTOR_BLOCK_MAX_BYTES,
      `A connector block's code is at most ${CONNECTOR_BLOCK_MAX_BYTES / 1024} KiB.`,
    ),
});
export interface ConnectorBlockSchema extends Named<typeof connectorBlockSchemaDefinition> {}
export const connectorBlockSchema: ConnectorBlockSchema = connectorBlockSchemaDefinition;
export type ConnectorBlock = z.infer<typeof connectorBlockSchema>;

const connectorAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  /** Runs once per turn: sends the scenario's message to the customer's API, returns the reply. */
  call: connectorBlockSchema,
  /** Makes the run's test data and returns `{ state, secrets? }`. */
  setup: connectorBlockSchema.optional(),
  /** Removes the test data, given the state setup returned. */
  teardown: connectorBlockSchema.optional(),
  /** The project secrets the blocks may read; no other secret travels to them. */
  secretNames: z
    .array(
      z
        .string()
        .regex(
          SECRET_NAME,
          "A secret name is capital letters, digits and underscores, starting with a letter.",
        ),
    )
    .default([]),
  /** The dataset whose rows every block receives as `rows`. */
  fixturesDatasetId: z.string().min(1).optional(),
  /** The call block's budget per turn, in milliseconds. */
  timeoutMs: z.number().int().positive().optional(),
});
export interface ConnectorAgentConfigSchema extends Named<
  typeof connectorAgentConfigSchemaDefinition
> {}
export const connectorAgentConfigSchema: ConnectorAgentConfigSchema =
  connectorAgentConfigSchemaDefinition;
export type ConnectorAgentConfig = z.infer<typeof connectorAgentConfigSchema>;
