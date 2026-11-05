import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  agentLabelSchema,
  agentVersionsSchema,
  assignAgentLabelInputSchema,
  removeAgentLabelInputSchema,
} from "./agent-version.ts";
import { createAgentCommandSchema, updateAgentCommandSchema } from "./agent.commands.ts";
import {
  agentCascadeArchiveSchema,
  agentCopySchema,
  agentHistoryEntrySchema,
  agentPushToCopiesSchema,
  agentSyncFromSourceSchema,
  agentWithLegacyCopyCountSchema,
} from "./agent.queries.ts";
import {
  agentApiAgentInputSchema,
  agentApiAgentReferenceInputSchema,
  agentApiProjectInputSchema,
  agentApiPushToCopiesInputSchema,
} from "./agent.schemas.ts";
import { AGENT_READ_HINTS, agentSchema, agentWithFieldsSchema } from "./agent.ts";

export const agentTrpc = defineTrpcContract("agents")
  .query("getAll", { invalidatedBy: AGENT_READ_HINTS })
  .withInput(agentApiProjectInputSchema)
  .withOutput(agentWithLegacyCopyCountSchema.array())

  .query("getById", { invalidatedBy: AGENT_READ_HINTS })
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

  .query("getCopies", { invalidatedBy: AGENT_READ_HINTS })
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentCopySchema.array())

  .mutation("pushToCopies")
  .withInput(agentApiPushToCopiesInputSchema)
  .withOutput(agentPushToCopiesSchema)

  .mutation("syncFromSource")
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentSyncFromSourceSchema)

  .query("getHistory", { invalidatedBy: AGENT_READ_HINTS })
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentHistoryEntrySchema.array())

  .query("listVersions", { invalidatedBy: AGENT_READ_HINTS })
  .withInput(agentApiAgentReferenceInputSchema)
  .withOutput(agentVersionsSchema)

  .mutation("assignLabel")
  .withInput(assignAgentLabelInputSchema)
  .withOutput(agentLabelSchema)

  .mutation("removeLabel")
  .withInput(removeAgentLabelInputSchema)
  .withOutput(z.void())

  .build();
