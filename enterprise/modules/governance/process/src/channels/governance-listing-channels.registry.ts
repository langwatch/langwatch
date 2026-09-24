// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpAdminApiUsersChannel } from "./http/http.admin-api-users.channel.ts";
import { HttpCopilotBotsChannel } from "./http/http.copilot-bots.channel.ts";
import { HttpDatabricksScimUsersChannel } from "./http/http.databricks-scim-users.channel.ts";
import { HttpGenieSpacesChannel } from "./http/http.genie-spaces.channel.ts";
import { HttpMicrosoftDirectoryChannel } from "./http/http.microsoft-directory.channel.ts";
import { HttpProviderSignInChannel } from "./http/http.provider-sign-in.channel.ts";
import { MemoryAdminApiUsersChannel } from "./memory/memory.admin-api-users.channel.ts";
import { MemoryCopilotBotsChannel } from "./memory/memory.copilot-bots.channel.ts";
import { MemoryDatabricksScimUsersChannel } from "./memory/memory.databricks-scim-users.channel.ts";
import { MemoryGenieSpacesChannel } from "./memory/memory.genie-spaces.channel.ts";
import { MemoryMicrosoftDirectoryChannel } from "./memory/memory.microsoft-directory.channel.ts";
import { MemoryProviderSignInChannel } from "./memory/memory.provider-sign-in.channel.ts";

/** Who and what a provider lists: the people and agent discovery reads, one per subject. */
export const governanceListingChannels = {
  live: {
    adminApiUsers: HttpAdminApiUsersChannel,
    copilotBots: HttpCopilotBotsChannel,
    databricksScimUsers: HttpDatabricksScimUsersChannel,
    genieSpaces: HttpGenieSpacesChannel,
    microsoftDirectory: HttpMicrosoftDirectoryChannel,
    providerSignIn: HttpProviderSignInChannel,
  },
  memory: {
    adminApiUsers: MemoryAdminApiUsersChannel,
    copilotBots: MemoryCopilotBotsChannel,
    databricksScimUsers: MemoryDatabricksScimUsersChannel,
    genieSpaces: MemoryGenieSpacesChannel,
    microsoftDirectory: MemoryMicrosoftDirectoryChannel,
    providerSignIn: MemoryProviderSignInChannel,
  },
};
