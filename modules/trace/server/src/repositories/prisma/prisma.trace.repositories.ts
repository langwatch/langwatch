import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { TraceRepositories } from "../trace.repositories.ts";
import { PrismaTraceEditOverlayRepository } from "./prisma.trace-edit-overlay.repository.ts";

/** The "postgres" tier for the trace module's Postgres-backed rows. */
export class PostgresTraceRepositories {
  static readonly requires = ["prisma"] as const;

  static create(infrastructure: Readonly<{ prisma: PrismaClient }>): TraceRepositories {
    return {
      editOverlay: PrismaTraceEditOverlayRepository.create(infrastructure.prisma),
    };
  }
}
