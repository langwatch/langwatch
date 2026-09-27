import { HttpHubspotFormChannel } from "./http/http.hubspot-form.channel.ts";
import { MemoryHubspotFormChannel } from "./memory/memory.hubspot-form.channel.ts";

export const hubspotFormChannels = {
  live: HttpHubspotFormChannel,
  memory: MemoryHubspotFormChannel,
};
