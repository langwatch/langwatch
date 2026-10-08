import { defineTrpcContract } from "@langwatch/module";

import {
  createAgentCommandSchema,
  updateAgentCommandSchema,
  httpAgentTestInputSchema,
} from "./agent.commands.ts";
import {
  agentCascadeArchiveSchema,
  agentCopySchema,
  agentHistoryEntrySchema,
  agentPushToCopiesSchema,
  agentSyncFromSourceSchema,
  agentWithLegacyCopyCountSchema,
  httpProxyResultSchema,
} from "./agent.queries.ts";
import {
  agentApiAgentInputSchema,
  agentApiAgentReferenceInputSchema,
  agentApiProjectInputSchema,
  agentApiPushToCopiesInputSchema,
} from "./agent.schemas.ts";
import { agentSchema, agentWithFieldsSchema } from "./agent.ts";

export const agentTrpc = defineTrpcContract("agents")
  .query("getAll")
  .withInput(agentApiProjectInputSchema)
  .withOutput(agentWithLegacyCopyCountSchema.array())

  .query("getById")
  .withInput(agentApiAgentInputSchema)
  .withOutput(agentWithLegacyCopyCountSchema)

  .mutation("create")
  .withInput(createAgentCommandSchema)
  .withOutput(agentWithFieldsSchema)

  .mutation("update")
  .withInput(updateAgentCommandSchema)
  .withOutput(agentWithFieldsSchema)

  .mutation("cascadeArchive")
  .withInput(agentApiAgentInputSchema)
  .withOutput(agentCascadeArchiveSchema)

  .mutation("delete")
  .withInput(agentApiAgentInputSchema)
  .withOutput(agentSchema)

  .query("getCopies")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentCopySchema.array())

  .mutation("pushToCopies")
  .withInput(agentApiPushToCopiesInputSchema)
  .withOutput(agentPushToCopiesSchema)

  .mutation("syncFromSource")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentSyncFromSourceSchema)

  .query("getHistory")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentHistoryEntrySchema.array())

  .build();

export const httpProxyTrpc = defineTrpcContract("httpProxy")
  .mutation("execute")
  .withInput(httpAgentTestInputSchema)
  .withOutput(httpProxyResultSchema)
  .build();
