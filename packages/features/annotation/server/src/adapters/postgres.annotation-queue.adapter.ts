import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createPrismaAnnotationQueueStore } from "../repositories/prisma/prisma.annotation-queue.repository";

/**
 * The queue rows over Postgres, as the annotation transport's queue port.
 *
 * Built per request from the request's own client, the way the application
 * reached those rows before the store moved: a queue item's visibility depends
 * on the caller's organization, so nothing here is process-wide.
 */
export class PostgresAnnotationQueueAdapter {
  private constructor(private readonly options: { database: PrismaClient }) {}

  static create(options: { database: PrismaClient }): PostgresAnnotationQueueAdapter {
    return new PostgresAnnotationQueueAdapter(options);
  }

  /**
   * The return type is deliberately INFERRED, never annotated as
   * `AnnotationQueueStore`: the port declares `unknown` wherever the transport
   * only hands a row straight back to the caller, so annotating it would
   * narrow every queue row the client receives to `unknown`. The `satisfies`
   * check inside the repository is what proves the port is answered in full.
   */
  build() {
    return createPrismaAnnotationQueueStore(this.options.database);
  }
}
