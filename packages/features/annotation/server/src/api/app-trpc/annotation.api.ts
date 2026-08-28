/**
 * The project's annotations and annotation queues over a host's tRPC transport.
 *
 *   create / updateByTraceId / deleteById: one reviewer comment on a trace, or
 *                        on a part of it named by its anchor. A changed
 *                        suggested output is carried into the trace's
 *                        correction before the comment is saved.
 *   getByTraceId(s):     the comments on a trace, or on a page of traces.
 *   getById / getAll:    one comment, and the project's annotations list and
 *                        the export taken from it.
 *   createOrUpdateQueue: the queue definition — its name, description, members
 *                        and score types.
 *   getQueues / getQueueBySlugOrId / getQueueItemsCounts: what the queue
 *                        picker and the sidebar read.
 *   getQueueItems / getOptimizedAnnotationQueues: the review page, with each
 *                        item's trace content and comments resolved.
 *   createQueueItem / markQueueItemDone / deleteQueueItems: queueing traces for
 *                        review, finishing an item, and taking an unreviewable
 *                        one off the queue.
 *   getPendingItemsCount / getAssignedItemsCount: the queue badges.
 *
 * Reading takes `annotations:view`; commenting takes `annotations:create`,
 * editing `annotations:update`, and removing `annotations:delete`.
 *
 * Transport only: policy, host capabilities, and delegation to
 * `AnnotationService`. Queue persistence, trace resolution and the trace
 * correction overlay arrive as host ports, because they are not Annotation's
 * own storage.
 *
 * Spec: packages/features/annotation/specs/annotation-service.feature.
 */
import type {
  Annotation,
  AnnotationService,
  AnnotationUser,
} from "@langwatch/annotation-contract";
import {
  AnnotationNotFoundError,
  annotationAnchorColumnsSchema,
  annotationAnchorScopeSchema,
  refineAnnotationAnchorColumns,
  resolveAnnotationSuggestionTarget,
  withReadableAnnotationAnchor,
} from "@langwatch/annotation-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { UserFullProfile, UserService } from "@langwatch/user-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";

const logger = createLogger("langwatch:api:annotation");

type AnnotationApplication = Readonly<{
  annotations: AnnotationService;
  users: Pick<UserService, "getProfiles">;
}>;

/** The host supplies authentication; authorization arrives as `policy`. */
export type AnnotationTrpcContext = Readonly<{
  app: AnnotationApplication;
  actor(): Readonly<{ id: string }>;
}>;

type AnnotationTrpcProcedures<
  TContext extends AnnotationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The review-page filter, as the reviewer chose it. */
export type AnnotationQueueItemStatus = "pending" | "completed" | "all";

/**
 * Queue persistence, as the host owns it. Annotation's own service owns
 * annotations, scores and queue-item creation; the queue rows themselves are
 * still application-owned storage, so the host answers for them.
 *
 * Return types are deliberately `unknown` wherever the transport only hands
 * the value back to the caller: the concrete row type flows from the host's
 * implementation through to the client, so this port cannot silently narrow it.
 */
export type AnnotationQueueStore = Readonly<{
  /** Whether the project already has a queue addressed by this slug. */
  queueSlugExists(input: Readonly<{ projectId: string; slug: string }>): Promise<boolean>;
  createQueue(
    input: Readonly<{
      projectId: string;
      name: string;
      slug: string;
      description: string;
      userIds: readonly string[];
      scoreTypeIds: readonly string[];
    }>,
  ): Promise<unknown>;
  updateQueue(
    input: Readonly<{
      projectId: string;
      queueId: string;
      name: string;
      slug: string;
      description: string;
      userIds: readonly string[];
      scoreTypeIds: readonly string[];
    }>,
  ): Promise<unknown>;
  /** The project's queues, newest first, for the picker. */
  listQueues(input: Readonly<{ projectId: string }>): Promise<unknown>;
  /** One queue by slug or id, with its members and score types. */
  findQueue(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      slug?: string;
      queueId?: string;
    }>,
  ): Promise<unknown>;
  /** Every queue item in the project the caller's organization can see. */
  listQueueItems(
    input: Readonly<{ projectId: string; organizationId: string }>,
  ): Promise<ReadonlyArray<Readonly<{ traceId: string }>>>;
  /** Items still open that are the caller's to review, directly or by queue. */
  countPendingItems(
    input: Readonly<{ projectId: string; userId: string }>,
  ): Promise<number>;
  /** Items still open that are assigned to the caller by name. */
  countAssignedItems(
    input: Readonly<{ projectId: string; userId: string }>,
  ): Promise<number>;
  /** The caller's queues and how much is still open in each. */
  listMemberQueuePendingCounts(
    input: Readonly<{ projectId: string; userId: string }>,
  ): Promise<
    ReadonlyArray<
      Readonly<{ id: string; name: string; slug: string; pendingCount: number }>
    >
  >;
  /** @returns how many items were removed. */
  deleteQueueItems(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      userId: string;
      queueItemIds: readonly string[];
    }>,
  ): Promise<number>;
  /**
   * Marks one item reviewed. `matched` is false when the item is not the
   * caller's to finish, which is what the transport turns into a 404.
   */
  markQueueItemDone(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      userId: string;
      queueItemId: string;
    }>,
  ): Promise<Readonly<{ matched: boolean; item: unknown }>>;
  /** One page of the review list, plus the total the pager needs. */
  listQueueItemsPage(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      userId: string;
      status: AnnotationQueueItemStatus;
      queueId?: string;
      includeMemberQueues: boolean;
      startDate?: Date;
      endDate?: Date;
      pageSize: number;
      pageOffset: number;
      allQueueItems: boolean;
    }>,
  ): Promise<
    Readonly<{
      totalCount: number;
      items: ReadonlyArray<
        Readonly<{ id: string; traceId: string; annotationQueueId: string | null }>
      >;
    }>
  >;
  /** The named queues in full, each carrying the items the page will enrich. */
  listQueuesWithItems(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      queueIds: readonly string[];
    }>,
  ): Promise<
    ReadonlyArray<
      Readonly<{ AnnotationQueueItems: ReadonlyArray<Readonly<{ id: string }>> }>
    >
  >;
}>;

/**
 * The host capabilities this transport needs that are not Annotation's own.
 *
 * Each method that decides something about the caller is handed the request
 * context, so the host resolves the caller exactly as it always did.
 */
export type AnnotationTrpcPorts = Readonly<{
  /**
   * Queue persistence for one request. Handed the request context so the host
   * reaches its database exactly as it always did, rather than this transport
   * closing over a process-wide client.
   */
  queues(ctx: unknown): AnnotationQueueStore;
  /**
   * Whether the caller holds `permission` on the project. A suggested output
   * changes the trace itself, so it is carried over only for a caller who may
   * also update annotations; everyone else keeps the comment alone.
   */
  probeProjectPermission(
    ctx: unknown,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /**
   * Writes one suggestion into the trace's correction, or takes it back off
   * when the reviewer cleared the text.
   */
  writeTraceSuggestion(
    ctx: unknown,
    input: Readonly<{
      projectId: string;
      traceId: string;
      target: NonNullable<ReturnType<typeof resolveAnnotationSuggestionTarget>>;
      text: string;
      userId: string;
    }>,
  ): Promise<void>;
  /**
   * The trace content behind a set of queue items, with the caller's own
   * redactions applied. Resolved in full (#4991) because annotators label the
   * whole value, not a preview.
   */
  loadTraces(
    ctx: unknown,
    input: Readonly<{ projectId: string; traceIds: readonly string[] }>,
  ): Promise<ReadonlyArray<Readonly<{ trace_id: string }>>>;
  /** Records on the trace that a human has commented on it. Best effort. */
  recordAnnotationOnTrace(
    ctx: unknown,
    input: Readonly<{
      tenantId: string;
      traceId: string;
      annotationId: string;
      occurredAt: number;
    }>,
  ): Promise<void>;
  /** Takes that record back off when the comment goes. Best effort. */
  removeAnnotationFromTrace(
    ctx: unknown,
    input: Readonly<{
      tenantId: string;
      traceId: string;
      annotationId: string;
      occurredAt: number;
    }>,
  ): Promise<void>;
  /**
   * Queues traces for annotation. Owns which of the ids sent address a trace
   * this project actually holds, because that answer lives in trace storage.
   */
  queueTracesForAnnotation(
    ctx: unknown,
    input: Readonly<{
      projectId: string;
      traceIds: readonly string[];
      annotators: readonly string[];
      userId: string;
    }>,
  ): Promise<Readonly<{ created: number; skipped: number }>>;
  /** The slug `/annotations/<slug>` addresses, for a queue name. */
  toQueueSlug(name: string): string;
}>;

const scoreOptionSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  reason: z.string().optional().nullable(),
});

const scoreOptions = z.record(z.string(), scoreOptionSchema);

const createInputSchema = z
  .object({
    projectId: z.string(),
    comment: z.string().optional().nullable(),
    isThumbsUp: z.boolean().optional().nullable(),
    traceId: z.string(),
    scoreOptions: scoreOptions,
    expectedOutput: z.string().optional().nullable(),
  })
  .merge(annotationAnchorColumnsSchema)
  .superRefine(refineAnnotationAnchorColumns);

const updateInputSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  projectId: z.string(),
  comment: z.string().optional().nullable(),
  isThumbsUp: z.boolean().optional().nullable(),
  expectedOutput: z.string().optional().nullable(),
  scoreOptions: scoreOptions,
});

const byTraceIdInputSchema = z.object({
  traceId: z.string(),
  projectId: z.string(),
  anchor: annotationAnchorScopeSchema.optional().default("all"),
});

const byTraceIdsInputSchema = z.object({
  traceIds: z.array(z.string()),
  projectId: z.string(),
  anchor: annotationAnchorScopeSchema.optional().default("all"),
});

const annotationScopeSchema = z.object({
  annotationId: z.string(),
  projectId: z.string(),
});

const projectScopeSchema = z.object({ projectId: z.string() });

const listAllInputSchema = z.object({
  projectId: z.string(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

const queueConfigurationInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  userIds: z.array(z.string()),
  scoreTypeIds: z.array(z.string()),
  queueId: z.string().optional(),
});

const createQueueItemInputSchema = z.object({
  traceIds: z.array(z.string()),
  projectId: z.string(),
  annotators: z.array(z.string()),
});

const deleteQueueItemsInputSchema = z.object({
  projectId: z.string(),
  queueItemIds: z.array(z.string()).min(1),
});

const markQueueItemDoneInputSchema = z.object({
  queueItemId: z.string(),
  projectId: z.string(),
});

const queueBySlugOrIdInputSchema = z.object({
  projectId: z.string(),
  slug: z.string().optional(),
  queueId: z.string().optional(),
});

const optimizedQueuesInputSchema = z.object({
  projectId: z.string(),
  selectedAnnotations: z.string(),
  pageSize: z.number(),
  pageOffset: z.number(),
  queueId: z.string().optional(),
  showQueueAndUser: z.boolean().optional(),
  allQueueItems: z.boolean().optional(),
  // The list's date range. A queue item is dated by when it was queued, which
  // is what the reviewer sees in the list and filters on.
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

/** Slugs the queue URL space already spends on something else. */
const RESERVED_QUEUE_SLUGS = new Set(["all", "me", "my-queue"]);

type AnnotationWithFullUser = Annotation & { user: UserFullProfile | null };
type AnnotationWithUserSummary = Annotation & { user: AnnotationUser | null };

function enrichAnnotationsWithUsers(
  annotations: Annotation[],
  users: Pick<UserService, "getProfiles">,
  projection: "full",
): Promise<AnnotationWithFullUser[]>;
function enrichAnnotationsWithUsers(
  annotations: Annotation[],
  users: Pick<UserService, "getProfiles">,
  projection: "summary",
): Promise<AnnotationWithUserSummary[]>;
async function enrichAnnotationsWithUsers(
  annotations: Annotation[],
  users: Pick<UserService, "getProfiles">,
  projection: "full" | "summary",
): Promise<Array<AnnotationWithFullUser | AnnotationWithUserSummary>> {
  const userIds = [
    ...new Set(
      annotations.flatMap((annotation) =>
        annotation.userId === null ? [] : [annotation.userId],
      ),
    ),
  ];
  const profiles = await users.getProfiles({ userIds });
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  return annotations.map((annotation) => {
    const user = annotation.userId ? (profilesById.get(annotation.userId) ?? null) : null;
    if (projection === "full") return { ...annotation, user };
    return {
      ...annotation,
      user: user ? { id: user.id, name: user.name, image: user.image } : null,
    };
  });
}

/** The enriched items, in the order the queue listed them. */
function enrichedInListOrder<TEnriched>(
  queueItems: ReadonlyArray<Readonly<{ id: string }>>,
  enrichedById: ReadonlyMap<string, TEnriched>,
): TEnriched[] {
  return queueItems.flatMap((item) => {
    const enriched = enrichedById.get(item.id);
    return enriched === void 0 ? [] : [enriched];
  });
}

/**
 * Carries a changed suggestion into the trace correction before saving the
 * annotation. This ordering prevents a saved annotation from pointing at an
 * unapplied correction; retrying the same correction is a no-op.
 *
 * The annotation anchor selects the target. Unsupported anchors carry no
 * suggestion, and callers without update permission retain only the annotation.
 */
async function carrySuggestionToOverlay({
  ctx,
  ports,
  projectId,
  traceId,
  expectedOutput,
  previousExpectedOutput,
  userId,
  anchorKind,
  anchorId,
  anchorPath,
}: {
  ctx: unknown;
  ports: AnnotationTrpcPorts;
  projectId: string;
  traceId: string;
  expectedOutput?: string | null;
  previousExpectedOutput?: string | null;
  userId: string;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}): Promise<void> {
  if (expectedOutput === void 0) return;
  const next = expectedOutput ?? "";
  const previous = previousExpectedOutput ?? "";
  if (next === previous) return;

  const target = resolveAnnotationSuggestionTarget({
    traceId,
    anchorKind,
    anchorId,
    anchorPath,
  });
  if (!target) return;

  if (!(await ports.probeProjectPermission(ctx, projectId, "annotations:update"))) {
    return;
  }

  await ports.writeTraceSuggestion(ctx, {
    projectId,
    traceId,
    target,
    text: next,
    userId,
  });
}

/**
 * Installs the complete `annotation.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class AnnotationTrpcApi {
  static create<
    TContext extends AnnotationTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends AnnotationTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AnnotationTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /**
     * The trace content and the comments behind a page of queue items, joined
     * onto each item. A queue item is a whole trace to review, so it carries
     * every comment left on that trace, each one naming the part of it that
     * was commented on.
     */
    const enrichQueueItems = async <TItem extends Readonly<{ traceId: string }>>(
      ctx: AnnotationTrpcContext,
      projectId: string,
      queueItems: readonly TItem[],
    ) => {
      const traceIds = [...new Set(queueItems.map((item) => item.traceId))];

      const annotations = await ctx.app.annotations.list({
        projectId,
        traceIds,
        anchor: "all",
        order: "desc",
      });
      const annotationsWithUsers = await enrichAnnotationsWithUsers(
        annotations,
        ctx.app.users,
        "full",
      );

      const traces = await ports.loadTraces(ctx, { projectId, traceIds });

      const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));
      const annotationMap = new Map<string, Array<(typeof annotationsWithUsers)[number]>>();
      for (const annotation of annotationsWithUsers) {
        const existing = annotationMap.get(annotation.traceId);
        if (existing) existing.push(annotation);
        else annotationMap.set(annotation.traceId, [annotation]);
      }

      return queueItems.map((item) => ({
        ...item,
        trace: traceMap.get(item.traceId) ?? null,
        annotations: annotationMap.get(item.traceId) ?? [],
        scoreOptions: (annotationMap.get(item.traceId) ?? []).flatMap((annotation) =>
          annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : [],
        ),
      }));
    };

    return trpc.router({
      create: policy("annotations:create")(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }) => {
          const actor = ctx.actor();

          await carrySuggestionToOverlay({
            ctx,
            ports,
            projectId: input.projectId,
            traceId: input.traceId,
            expectedOutput: input.expectedOutput,
            userId: actor.id,
            anchorKind: input.anchorKind,
            anchorId: input.anchorId,
            anchorPath: input.anchorPath,
          });

          const createdAnnotation = await ctx.app.annotations.create({
            id: nanoid(),
            projectId: input.projectId,
            traceId: input.traceId,
            userId: actor.id,
            comment: input.comment ?? "",
            isThumbsUp: input.isThumbsUp ?? null,
            scoreOptions: input.scoreOptions ?? {},
            expectedOutput: input.expectedOutput ?? null,
            anchorKind: input.anchorKind,
            anchorId: input.anchorId,
            anchorPath: input.anchorPath,
          });

          // Best-effort trace sync: the annotation store is the source of
          // truth. Failures are logged but don't fail the mutation — the
          // backfill task can reconcile any missed syncs.
          //
          // Anchored comments sync too. This is what answers "has a human
          // touched this trace", which the has-annotation filter in search
          // reads, and a comment on one of its spans means yes.
          try {
            await ports.recordAnnotationOnTrace(ctx, {
              tenantId: input.projectId,
              traceId: input.traceId,
              annotationId: createdAnnotation.id,
              occurredAt: Date.now(),
            });
          } catch (error) {
            logger.error(
              { error, traceId: input.traceId, projectId: input.projectId },
              "Failed to sync annotation to ClickHouse",
            );
          }

          return createdAnnotation;
        },
      ),

      updateByTraceId: policy("annotations:update")(
        procedure.input(updateInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        const service = ctx.app.annotations;

        // The suggestion the annotation held before this save is what tells a
        // real edit apart from a form re-sending what it loaded, so it is read
        // before the row moves. The anchor comes from the same read rather
        // than from the input: editing a comment changes what it says, never
        // what it is about, so re-anchoring is a delete and a create.
        const existing = await service.getById({
          id: input.id,
          projectId: input.projectId,
        });

        await carrySuggestionToOverlay({
          ctx,
          ports,
          projectId: input.projectId,
          traceId: input.traceId,
          expectedOutput: input.expectedOutput,
          previousExpectedOutput: existing.expectedOutput,
          userId: actor.id,
          anchorKind: existing.anchorKind,
          anchorId: existing.anchorId,
          anchorPath: existing.anchorPath,
        });

        return service.update({
          id: input.id,
          projectId: input.projectId,
          traceId: input.traceId,
          comment: input.comment ?? "",
          isThumbsUp: input.isThumbsUp,
          scoreOptions: input.scoreOptions ?? {},
          // A save that does not carry the field leaves the suggestion where
          // it is, the same way it leaves the trace's correction alone. Only
          // an explicit null or empty text withdraws it.
          expectedOutput: input.expectedOutput,
        });
      }),

      /**
       * The comments on one trace. Defaults to every comment, anchored ones
       * included: this is the read behind a trace's own comment list, where a
       * comment about one of its spans belongs. A caller answering a question
       * about the trace as a whole asks for `anchor: "trace"` instead.
       */
      getByTraceId: policy("annotations:view")(
        procedure.input(byTraceIdInputSchema),
      ).query(async ({ ctx, input }) => {
        const annotations = await ctx.app.annotations.list({
          projectId: input.projectId,
          traceIds: [input.traceId],
          anchor: input.anchor,
          order: "asc",
        });

        const annotationsWithUsers = await enrichAnnotationsWithUsers(
          annotations,
          ctx.app.users,
          "summary",
        );
        return annotationsWithUsers.map(withReadableAnnotationAnchor);
      }),

      /** Same contract as `getByTraceId`, for a page of traces. */
      getByTraceIds: policy("annotations:view")(
        procedure.input(byTraceIdsInputSchema),
      ).query(async ({ ctx, input }) => {
        const annotations = await ctx.app.annotations.list({
          projectId: input.projectId,
          traceIds: input.traceIds,
          anchor: input.anchor,
          order: "asc",
        });

        const annotationsWithUsers = await enrichAnnotationsWithUsers(
          annotations,
          ctx.app.users,
          "summary",
        );
        return annotationsWithUsers.map(withReadableAnnotationAnchor);
      }),

      getById: policy("annotations:view")(procedure.input(annotationScopeSchema)).query(
        async ({ ctx, input }) => {
          try {
            return await ctx.app.annotations.getById({
              id: input.annotationId,
              projectId: input.projectId,
            });
          } catch (error) {
            if (error instanceof AnnotationNotFoundError) return null;
            throw error;
          }
        },
      ),

      deleteById: policy("annotations:delete")(
        procedure.input(annotationScopeSchema),
      ).mutation(async ({ ctx, input }) => {
        const deletedAnnotation = await ctx.app.annotations.delete({
          id: input.annotationId,
          projectId: input.projectId,
        });

        // Best-effort trace sync (see the create mutation comment above).
        try {
          await ports.removeAnnotationFromTrace(ctx, {
            tenantId: input.projectId,
            traceId: deletedAnnotation.traceId,
            annotationId: deletedAnnotation.id,
            occurredAt: Date.now(),
          });
        } catch (error) {
          logger.error(
            {
              error,
              traceId: deletedAnnotation.traceId,
              projectId: input.projectId,
            },
            "Failed to sync annotation removal to ClickHouse",
          );
        }

        return deletedAnnotation;
      }),

      /**
       * The project's annotations list, and the export taken from it. One row
       * per comment, anchored ones included: a reviewer who marked six spans
       * of one trace said six things, and a list that showed none of them
       * answered with silence. Each row carries its anchor, which is what
       * keeps them readable.
       */
      getAll: policy("annotations:view")(procedure.input(listAllInputSchema)).query(
        async ({ ctx, input }) => {
          const annotations = await ctx.app.annotations.list({
            projectId: input.projectId,
            anchor: "all",
            order: "desc",
            startDate: input.startDate,
            endDate: input.endDate,
          });
          return enrichAnnotationsWithUsers(annotations, ctx.app.users, "full");
        },
      ),

      createOrUpdateQueue: policy("annotations:create")(
        procedure.input(queueConfigurationInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.annotations.assertQueueConfigurationReferences({
          projectId: input.projectId,
          userIds: input.userIds,
          scoreTypeIds: input.scoreTypeIds,
        });

        const slug = ports.toQueueSlug(input.name);

        if (RESERVED_QUEUE_SLUGS.has(slug)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A annotation queue name is reserved.",
          });
        }

        const queue = {
          projectId: input.projectId,
          name: input.name,
          slug,
          description: input.description,
          userIds: input.userIds,
          scoreTypeIds: input.scoreTypeIds,
        };

        if (input.queueId) {
          return ports.queues(ctx).updateQueue({ ...queue, queueId: input.queueId });
        }

        if (await ports.queues(ctx).queueSlugExists({ projectId: input.projectId, slug })) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A annotation queue with this name already exists.",
          });
        }
        return ports.queues(ctx).createQueue(queue);
      }),

      getQueues: policy("annotations:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => ports.queues(ctx).listQueues({ projectId: input.projectId }),
      ),

      getQueueItems: policy("annotations:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) => {
        const organizationId = await ctx.app.annotations.getProjectOrganizationId({
          projectId: input.projectId,
        });
        const queueItems = await ports.queues(ctx).listQueueItems({
          projectId: input.projectId,
          organizationId,
        });

        const traceIds = [...new Set(queueItems.map((item) => item.traceId))];
        const traces = await ports.loadTraces(ctx, {
          projectId: input.projectId,
          traceIds,
        });
        const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));

        return queueItems.map((item) => ({
          ...item,
          trace: traceMap.get(item.traceId) ?? null,
        }));
      }),

      getPendingItemsCount: policy("annotations:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) =>
        ports.queues(ctx).countPendingItems({
          projectId: input.projectId,
          userId: ctx.actor().id,
        }),
      ),

      getAssignedItemsCount: policy("annotations:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) =>
        ports.queues(ctx).countAssignedItems({
          projectId: input.projectId,
          userId: ctx.actor().id,
        }),
      ),

      getQueueItemsCounts: policy("annotations:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) =>
        ports.queues(ctx).listMemberQueuePendingCounts({
          projectId: input.projectId,
          userId: ctx.actor().id,
        }),
      ),

      createQueueItem: policy("annotations:create")(
        procedure.input(createQueueItemInputSchema),
      ).mutation(async ({ ctx, input }) =>
        ports.queueTracesForAnnotation(ctx, {
          traceIds: input.traceIds,
          projectId: input.projectId,
          annotators: input.annotators,
          userId: ctx.actor().id,
        }),
      ),

      /**
       * Takes queue items out of the reviewer's queue for good. What it is for
       * is an item there is nothing to review on: its trace no longer
       * resolves, so it can neither be read nor annotated nor finished, and
       * leaving it there keeps the queue from ever reading as complete.
       *
       * Scoped to the items the caller is responsible for, the same reach as
       * marking and clearing marks: removing a teammate's item would take work
       * off a queue that is not the caller's to empty.
       */
      deleteQueueItems: policy("annotations:update")(
        procedure.input(deleteQueueItemsInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const organizationId = await ctx.app.annotations.getProjectOrganizationId({
          projectId: input.projectId,
        });
        const deleted = await ports.queues(ctx).deleteQueueItems({
          projectId: input.projectId,
          organizationId,
          userId: ctx.actor().id,
          queueItemIds: input.queueItemIds,
        });
        return { deleted };
      }),

      /**
       * Marks a queue item as reviewed. Scoped to the items the caller is
       * responsible for, the same reach as marking and removing: finishing a
       * teammate's item would clear work off a queue that is not the caller's.
       */
      markQueueItemDone: policy("annotations:update")(
        procedure.input(markQueueItemDoneInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const organizationId = await ctx.app.annotations.getProjectOrganizationId({
          projectId: input.projectId,
        });
        const marked = await ports.queues(ctx).markQueueItemDone({
          projectId: input.projectId,
          organizationId,
          userId: ctx.actor().id,
          queueItemId: input.queueItemId,
        });
        if (!marked.matched) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Queue item not found" });
        }
        return marked.item;
      }),

      getQueueBySlugOrId: policy("annotations:view")(
        procedure.input(queueBySlugOrIdInputSchema),
      ).query(async ({ ctx, input }) => {
        const organizationId = await ctx.app.annotations.getProjectOrganizationId({
          projectId: input.projectId,
        });
        return ports.queues(ctx).findQueue({
          projectId: input.projectId,
          organizationId,
          slug: input.slug,
          queueId: input.queueId,
        });
      }),

      getOptimizedAnnotationQueues: policy("annotations:view")(
        procedure.input(optimizedQueuesInputSchema),
      ).query(async ({ ctx, input }) => {
        const userId = ctx.actor().id;
        const organizationId = await ctx.app.annotations.getProjectOrganizationId({
          projectId: input.projectId,
        });

        const { totalCount, items } = await ports.queues(ctx).listQueueItemsPage({
          projectId: input.projectId,
          organizationId,
          userId,
          status:
            input.selectedAnnotations === "pending"
              ? "pending"
              : input.selectedAnnotations === "completed"
                ? "completed"
                : "all",
          queueId: input.queueId,
          includeMemberQueues: input.showQueueAndUser === true,
          startDate: input.startDate,
          endDate: input.endDate,
          pageSize: input.pageSize,
          pageOffset: input.pageOffset,
          allQueueItems: input.allQueueItems === true,
        });

        const queueIds = [
          ...new Set(
            items.flatMap((item) =>
              item.annotationQueueId === null ? [] : [item.annotationQueueId],
            ),
          ),
        ];

        const queues = await ports.queues(ctx).listQueuesWithItems({
          projectId: input.projectId,
          organizationId,
          queueIds,
        });

        const enrichedQueueItems = await enrichQueueItems(ctx, input.projectId, items);
        const enrichedById = new Map(
          enrichedQueueItems.map((item) => [item.id, item] as const),
        );

        const processedQueues = queues.map((queue) => ({
          ...queue,
          AnnotationQueueItems: enrichedInListOrder(
            queue.AnnotationQueueItems,
            enrichedById,
          ),
        }));

        return {
          assignedQueueItems: enrichedQueueItems,
          queues: processedQueues,
          totalCount,
        };
      }),
    });
  }
}
