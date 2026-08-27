import {
  SlackWebApiDeliveryAdapter,
  type SlackApiTransport,
  type SlackChannelListing,
} from "@langwatch/automation-server";
import type { SlackPayload } from "@langwatch/automation-contract";
import { sendHttpDestination } from "~/server/webhooks/httpDestination";
import { webhookUrlValidator } from "~/server/webhooks/urlPolicy";

const validateSlackApiUrl = webhookUrlValidator(false);

const transport: SlackApiTransport = {
  request: (input) =>
    sendHttpDestination({
      ...input,
      validateUrl: validateSlackApiUrl,
    }),
};

const delivery = SlackWebApiDeliveryAdapter.create(transport);

export function postSlackChatMessage(input: {
  token: string;
  channel: string;
  payload: SlackPayload;
  triggerName: string;
}): Promise<void> {
  return delivery.post(input);
}

export function listSlackChannels(token: string): Promise<SlackChannelListing> {
  return delivery.list(token);
}

export type {
  SlackChannel,
  SlackChannelListGap,
  SlackChannelListing,
} from "@langwatch/automation-server";
