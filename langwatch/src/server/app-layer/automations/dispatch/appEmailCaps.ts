import { createEmailCaps } from "@langwatch/automations-server/dispatch/email-caps";
import { connection } from "~/server/redis";

/** The app-backed ADR-031 email caps (ADR-063 §1): Redis when available,
 *  the package's in-memory fallback otherwise. */
export const { consumeEmailCapSlot, consumeTenantEmailCapSlot } =
  createEmailCaps({ redis: connection });
