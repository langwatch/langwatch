import type { Prisma } from "@prisma/client";

/**
 * JSON payload stored on a ReactorOutbox row.
 *
 * Variable-size data goes here (trigger config, target ids, rendered
 * template inputs) so wakeup payloads stay constant-size — see ADR-026.
 */
export type OutboxPayload = Prisma.InputJsonValue;
