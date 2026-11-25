import { defineRepositories } from "@langwatch/process";

import { MemoryWebhookRepositories } from "./memory/memory.webhook.repositories.ts";
import { PostgresWebhookRepositories } from "./prisma/prisma.webhook.repositories.ts";

export const webhookRepositories = defineRepositories({
  live: PostgresWebhookRepositories,
  memory: MemoryWebhookRepositories,
});
