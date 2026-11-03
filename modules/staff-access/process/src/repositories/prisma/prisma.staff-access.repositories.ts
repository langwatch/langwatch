/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)` because the claims are
 * raw statements, which the declared-delegate client does not carry.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { StaffAccessRepositories } from "../staff-access.repositories.ts";
import { PrismaStaffAccessChallengeRepository } from "./prisma.staff-access-challenge.repository.ts";
import { PrismaStaffAccessEventRepository } from "./prisma.staff-access-event.repository.ts";
import { PrismaStaffAccessRequestRepository } from "./prisma.staff-access-request.repository.ts";
import { PrismaStaffAccessRequesterRepository } from "./prisma.staff-access-requester.repository.ts";

export class PostgresStaffAccessRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): StaffAccessRepositories {
    return {
      requesters: PrismaStaffAccessRequesterRepository.create(members.prisma),
      challenges: PrismaStaffAccessChallengeRepository.create(members.prisma),
      requests: PrismaStaffAccessRequestRepository.create(members.prisma),
      events: PrismaStaffAccessEventRepository.create(members.prisma),
    };
  }
}
