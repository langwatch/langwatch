import type { Named } from "@langwatch/module";
import { z } from "zod";

import { baseAgentConfigSchema } from "./code.ts";

/**
 * An agent that is an API the customer already hosts. LangWatch runs three Python slots against
 * it in its own sandbox: `turn` (required) and the optional `setup` and `teardown` that make and
 * remove test data around a scenario run (ADR-180). The customer hosts nothing for the hooks.
 */
const apiAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  /** The API the slots call; handed to each slot as `api.base_url`. */
  baseUrl: z.string().min(1, "Base URL is required"),
  /** A project secret reference such as `{{ secrets.NAME }}`, handed to slots as `api.api_key`. */
  apiKey: z.string().optional(),
  /** Python defining `def turn(api, message, history, state) -> str`. */
  turn: z.string().min(1, "The turn slot is required"),
  /** Python defining `def setup(api, params) -> dict`: ids only, it is the run's state. */
  setup: z.string().optional(),
  /** Python defining `def teardown(api, state, params) -> dict | None`. */
  teardown: z.string().optional(),
  /** The dataset the setup test data comes from; kept on the config, not yet given to setup. */
  fixturesDatasetId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export interface ApiAgentConfigSchema extends Named<typeof apiAgentConfigSchemaDefinition> {}
export const apiAgentConfigSchema: ApiAgentConfigSchema = apiAgentConfigSchemaDefinition;
export type ApiAgentConfig = z.infer<typeof apiAgentConfigSchema>;
