// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EventReadSeat } from "@langwatch/eventing";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { EventingScimSyncActivityRepository } from "../eventing/eventing.scim-sync-activity.repository.ts";
import type { ScimRepositories } from "../scim.repositories.ts";
import { PrismaScimSeatRepository } from "./prisma.scim-seat.repository.ts";
import { PrismaScimSsoConnectionRepository } from "./prisma.scim-sso-connection.repository.ts";
import {
  PrismaScimSyncProjectionRepository,
  type ScimOperatorReadsMember,
} from "./prisma.scim-sync-projection.repository.ts";
import { PrismaScimRepository } from "./prisma.scim.repository.ts";

/** SCIM's live store: the Postgres rows the directory writes, and its declared operator read. */
export class PostgresScimRepositories {
  static readonly requires = ["prisma", "operatorReads", "eventReadSeat"] as const;

  static create({
    prisma,
    operatorReads,
    eventReadSeat,
  }: {
    prisma: PrismaClient;
    eventReadSeat: EventReadSeat;
  } & ScimOperatorReadsMember): ScimRepositories {
    return {
      scim: PrismaScimRepository.create(prisma),
      scimSyncs: PrismaScimSyncProjectionRepository.create({ prisma, operatorReads }),
      scimSyncActivity: EventingScimSyncActivityRepository.create({ eventReadSeat }),
      scimSsoConnections: PrismaScimSsoConnectionRepository.create(prisma),
      seats: PrismaScimSeatRepository.create(prisma),
    };
  }
}
