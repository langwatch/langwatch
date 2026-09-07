/**
 * What an annotation queue read answers.
 *
 * The store's port declared `Promise<unknown>` for these, under a note saying
 * the concrete row flowed to the client through the host's implementation. It
 * does not — a tRPC procedure publishes what its handler returns, and
 * `unknown` reaches the browser as `{}`, so the queue drawer and the queue
 * page read every field off nothing. Worse, nothing could see what the reads
 * were publishing: they returned a Prisma row built with
 * `include: { user: true }`, which is every column of `User`.
 *
 * These shapes are exactly what the narrowed selects return.
 */
import type { Annotation } from "./annotation.record.ts";

/**
 * One annotation queue, as its own row. Its timestamps are the wire
 * timestamps every annotation row in this contract carries.
 */
export type AnnotationQueueRecord = Pick<Annotation, "createdAt" | "updatedAt"> & {
  id: string;
  name: string;
  slug: string;
  projectId: string;
  description: string | null;
};

/** A queue in the picker: enough to name it and to link to it. */
export interface AnnotationQueueListEntry {
  id: string;
  name: string;
  slug: string;
}

/** A person on a queue, as the member avatars render them. */
export interface AnnotationQueueMemberView {
  user: { id: string; name: string | null; image: string | null };
}

/** A score type attached to a queue, as the picker lists it. */
export interface AnnotationQueueScoreView {
  annotationScore: { id: string; name: string };
}

/** One queue with the two lists the drawer and the queue page render. */
export type AnnotationQueueDetail = AnnotationQueueRecord & {
  members: AnnotationQueueMemberView[];
  AnnotationQueueScores: AnnotationQueueScoreView[];
};
