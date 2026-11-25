// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpAdminApiUsersChannel } from "./http/http.admin-api-users.channel.ts";
import { HttpArdRegistryChannel } from "./http/http.ard-registry.channel.ts";
import { HttpAwsAgentInventoryChannel } from "./http/http.aws-agent-inventory.channel.ts";
import { HttpCopilotBotsChannel } from "./http/http.copilot-bots.channel.ts";
import { HttpDatabricksScimUsersChannel } from "./http/http.databricks-scim-users.channel.ts";
import { HttpGenieSpacesChannel } from "./http/http.genie-spaces.channel.ts";
import { HttpMicrosoftDirectoryChannel } from "./http/http.microsoft-directory.channel.ts";
import { HttpProviderSignInChannel } from "./http/http.provider-sign-in.channel.ts";
import { HttpVertexAgentEngineChannel } from "./http/http.vertex-agent-engine.channel.ts";
import { MemoryAdminApiUsersChannel } from "./memory/memory.admin-api-users.channel.ts";
import { MemoryArdRegistryChannel } from "./memory/memory.ard-registry.channel.ts";
import { MemoryAwsAgentInventoryChannel } from "./memory/memory.aws-agent-inventory.channel.ts";
import { MemoryCopilotBotsChannel } from "./memory/memory.copilot-bots.channel.ts";
import { MemoryDatabricksScimUsersChannel } from "./memory/memory.databricks-scim-users.channel.ts";
import { MemoryGenieSpacesChannel } from "./memory/memory.genie-spaces.channel.ts";
import { MemoryMicrosoftDirectoryChannel } from "./memory/memory.microsoft-directory.channel.ts";
import { MemoryObjectStoreChannel } from "./memory/memory.object-store.channel.ts";
import { MemoryProviderSignInChannel } from "./memory/memory.provider-sign-in.channel.ts";
import { MemorySecurityLakeQueueChannel } from "./memory/memory.security-lake-queue.channel.ts";
import { MemoryVertexAgentEngineChannel } from "./memory/memory.vertex-agent-engine.channel.ts";
import { S3ObjectStoreChannel } from "./s3/s3.object-store.channel.ts";
import { SqsSecurityLakeQueueChannel } from "./sqs/sqs.security-lake-queue.channel.ts";

/** Who and what a provider lists, one per subject, and the source buckets its pullers read. */
export const governanceListingChannels = {
  live: {
    adminApiUsers: HttpAdminApiUsersChannel,
    ardRegistry: HttpArdRegistryChannel,
    awsAgentInventory: HttpAwsAgentInventoryChannel,
    copilotBots: HttpCopilotBotsChannel,
    databricksScimUsers: HttpDatabricksScimUsersChannel,
    genieSpaces: HttpGenieSpacesChannel,
    microsoftDirectory: HttpMicrosoftDirectoryChannel,
    objectStore: S3ObjectStoreChannel,
    providerSignIn: HttpProviderSignInChannel,
    vertexAgentEngine: HttpVertexAgentEngineChannel,
    securityLakeQueue: SqsSecurityLakeQueueChannel,
  },
  memory: {
    adminApiUsers: MemoryAdminApiUsersChannel,
    ardRegistry: MemoryArdRegistryChannel,
    awsAgentInventory: MemoryAwsAgentInventoryChannel,
    copilotBots: MemoryCopilotBotsChannel,
    databricksScimUsers: MemoryDatabricksScimUsersChannel,
    genieSpaces: MemoryGenieSpacesChannel,
    microsoftDirectory: MemoryMicrosoftDirectoryChannel,
    objectStore: MemoryObjectStoreChannel,
    providerSignIn: MemoryProviderSignInChannel,
    vertexAgentEngine: MemoryVertexAgentEngineChannel,
    securityLakeQueue: MemorySecurityLakeQueueChannel,
  },
};
