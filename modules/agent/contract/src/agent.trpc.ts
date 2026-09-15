import { defineTrpcContract } from "@langwatch/api/contract";
import { createAgentCommandSchema, updateAgentCommandSchema } from "./agent.commands.ts";
import {
  agentApiAgentInputSchema,
  agentApiAgentReferenceInputSchema,
  agentApiCopyRequestSchema,
  agentApiProjectInputSchema,
  agentApiPushToCopiesInputSchema,
  agentApiTestTurnInputSchema,
} from "./agent.schemas.ts";
import {
  agentCascadeArchiveSchema,
  agentCopyCreatedSchema,
  agentCopySchema,
  agentHistoryEntrySchema,
  agentPushToCopiesSchema,
  agentSyncFromSourceSchema,
  agentTestRunResultSchema,
  agentTestTurnResultSchema,
  relatedAgentEntitiesSchema,
  agentWithLegacyCopyCountSchema,
} from "./agent.queries.ts";
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

  .query("getRelatedEntities")
  .withInput(agentApiAgentInputSchema)
  .withOutput(relatedAgentEntitiesSchema)

  .mutation("cascadeArchive")
  .withInput(agentApiAgentInputSchema)
  .withOutput(agentCascadeArchiveSchema)

  .mutation("delete")
  .withInput(agentApiAgentInputSchema)
  .withOutput(agentSchema)

  .query("getCopies")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentCopySchema.array())

  .mutation("copy")
  .withInput(agentApiCopyRequestSchema)
  .withOutput(agentCopyCreatedSchema)

  .mutation("pushToCopies")
  .withInput(agentApiPushToCopiesInputSchema)
  .withOutput(agentPushToCopiesSchema)

  .mutation("syncFromSource")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentSyncFromSourceSchema)

  .query("getHistory")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentHistoryEntrySchema.array())

  .mutation("testTurn")
  .withInput(agentApiTestTurnInputSchema)
  .withOutput(agentTestTurnResultSchema)

  .mutation("testRun")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentTestRunResultSchema)
  .build();
