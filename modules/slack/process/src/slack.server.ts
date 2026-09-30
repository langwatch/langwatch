import { defineServerModule } from "@langwatch/kernel";

import { SlackApp } from "./app/slack.app.ts";

export const slackServer = defineServerModule("slack").withApp(SlackApp).build();
