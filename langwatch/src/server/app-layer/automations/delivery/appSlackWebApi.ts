import { createSlackWebApiClient } from "@langwatch/automations-server/clients/slack/web-api.client";
import { appHttpEgress } from "./appHttpEgress";

/**
 * The app-configured Slack Web API client (ADR-063 §1): the package owns the
 * chat.postMessage / conversations.list logic, the app contributes only its
 * SSRF-fenced egress.
 */
export const { postSlackChatMessage, listSlackChannels } =
  createSlackWebApiClient({ egress: appHttpEgress });
