// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpBedrockAgentAliasChannel } from "./http/http.bedrock-agent-alias.channel.ts";
import { HttpDatabricksServingEndpointChannel } from "./http/http.databricks-serving-endpoint.channel.ts";
import { MemoryBedrockAgentAliasChannel } from "./memory/memory.bedrock-agent-alias.channel.ts";
import { MemoryDatabricksServingEndpointChannel } from "./memory/memory.databricks-serving-endpoint.channel.ts";

/** The platforms a kill switch target stops and restores, one channel per platform. */
export const killSwitchChannels = {
  live: {
    servingEndpoints: HttpDatabricksServingEndpointChannel,
    bedrockAliases: HttpBedrockAgentAliasChannel,
  },
  memory: {
    servingEndpoints: MemoryDatabricksServingEndpointChannel,
    bedrockAliases: MemoryBedrockAgentAliasChannel,
  },
};
