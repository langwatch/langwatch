import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { PresenceRepositories } from "../presence.repositories.ts";
import { PrismaPresenceSettingsRepository } from "./prisma.presence-settings.repository.ts";

/** Presence owns no table; it reads the settings its owners hold through their shares (R40). */
export class PostgresPresenceRepositories {
  static readonly requires = ["prisma"] as const;

  static create({
    prisma,
  }: Readonly<{ prisma: PrismaClient }>): Pick<PresenceRepositories, "settings"> {
    return { settings: PrismaPresenceSettingsRepository.create({ prisma }) };
  }
}
