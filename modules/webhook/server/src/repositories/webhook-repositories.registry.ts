import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryWebhookRepositories } from "./memory/memory.webhook.repositories.ts";
import { PostgresWebhookRepositories } from "./prisma/prisma.webhook.repositories.ts";

export const webhookRepositories = defineRepositories({
  postgres: PostgresWebhookRepositories,
  memory: MemoryWebhookRepositories,
});
