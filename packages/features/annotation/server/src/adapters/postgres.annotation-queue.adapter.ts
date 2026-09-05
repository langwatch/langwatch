import {
  PrismaAnnotationQueueRepository,
  type AnnotationQueueDatabase,
} from "../repositories/prisma/prisma.annotation-queue.repository";

/**
 * The queue rows over Postgres, as the annotation transport's queue port.
 */
export class PostgresAnnotationQueueAdapter {
  private constructor(private readonly options: { database: AnnotationQueueDatabase }) {}

  static create(options: { database: AnnotationQueueDatabase }): PostgresAnnotationQueueAdapter {
    return new PostgresAnnotationQueueAdapter(options);
  }

  /**
   * The return type is deliberately INFERRED, never annotated as `AnnotationQueueStore`: the
   * port declares `unknown` wherever the transport only hands a row straight back to the
   * caller, so annotating it would narrow every queue row the client receives to `unknown`.
   */
  build() {
    return PrismaAnnotationQueueRepository.create(this.options.database);
  }
}
