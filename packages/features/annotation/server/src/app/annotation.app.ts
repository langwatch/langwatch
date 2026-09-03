/**
 * The annotation feature's application: what both of its doors call.
 *
 * It holds every service the feature's api files reach — the annotation
 * capability itself and the user directory a comment's author is resolved
 * through — and it is the one typed thing a transport is given. Before it, the
 * comment door declared `Readonly<{ annotations; users }>` and the score door
 * declared `Readonly<{ annotations }>`: two descriptions of the same
 * composition, agreeing by attention rather than by construction, and neither
 * reachable from the other.
 *
 * Most operations are `AnnotationService`'s own. What lives here as a rule of
 * its own is what a door would otherwise have to decide for itself:
 *
 *   - joining comments to the people who left them, which needs BOTH services
 *     at once and so was the one thing the score door could never do;
 *   - attributing a comment to its author, which the create path stamped
 *     itself;
 *   - which queue names the URL space has already spent, and that a name
 *     already in use is a refusal rather than a second queue.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  AnnotationNotFoundError,
  type Annotation,
  type AnnotationByIdInput,
  type AnnotationProjectInput,
  type AnnotationScore,
  type AnnotationScoreByIdInput,
  type AnnotationService,
  type AnnotationUser,
  type AssertQueueConfigurationReferencesInput,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationScoresInput,
  type ListAnnotationsInput,
  type ToggleAnnotationScoreInput,
  type UpdateAnnotationInput,
  type UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { UserFullProfile, UserService } from "@langwatch/user-contract";

/** Who a comment is attributed to. */
export interface AnnotationCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface AnnotationAppDependencies {
  annotations: AnnotationService;
  users: Pick<UserService, "getProfiles">;
}

/** A comment with the reviewer's whole profile, for the annotations list. */
export type AnnotationWithFullUser = Annotation & { user: UserFullProfile | null };

/** A comment with just enough of the reviewer to render an avatar. */
export type AnnotationWithUserSummary = Annotation & { user: AnnotationUser | null };

/** Slugs the queue URL space already spends on something else. */
const RESERVED_QUEUE_SLUGS = new Set(["all", "me", "my-queue"]);

/** The queue name resolves to a slug the annotation URLs already use. */
export class AnnotationQueueNameReservedError extends HandledError {
  declare readonly code: "annotation_queue_name_reserved";

  constructor(slug: string) {
    super("annotation_queue_name_reserved", "That annotation queue name is reserved", {
      httpStatus: 409,
      fault: "customer",
      meta: { slug },
    });
    this.name = "AnnotationQueueNameReservedError";
  }
}

/** The project already has a queue addressed by this name. */
export class AnnotationQueueNameTakenError extends HandledError {
  declare readonly code: "annotation_queue_name_taken";

  constructor(slug: string) {
    super(
      "annotation_queue_name_taken",
      "An annotation queue with this name already exists",
      { httpStatus: 409, fault: "customer", meta: { slug } },
    );
    this.name = "AnnotationQueueNameTakenError";
  }
}

/** No open queue item by that id that is this reviewer's to finish. */
export class AnnotationQueueItemNotFoundError extends NotFoundError {
  declare readonly code: "annotation_queue_item_not_found";

  constructor(queueItemId: string) {
    super("annotation_queue_item_not_found", "Queue item", queueItemId, {
      meta: { queueItemId },
    });
    this.name = "AnnotationQueueItemNotFoundError";
  }
}

export class AnnotationApp {
  static create(dependencies: AnnotationAppDependencies): AnnotationApp {
    return new AnnotationApp(dependencies);
  }

  private constructor(private readonly dependencies: AnnotationAppDependencies) {}

  /**
   * The service itself, for `createOrUpdateQueueItems`.
   *
   * That queueing function is this package's own, but it is not reachable from
   * here: it takes the trace-storage read that decides which of the requested
   * ids actually address a trace, which is another feature's persistence and
   * therefore the process's to supply. So the process calls it, and this getter
   * is what it hands over — the same seam `EvaluatorApp.evaluatorService` keeps.
   */
  get annotationService(): AnnotationService {
    return this.dependencies.annotations;
  }

  // -- comments --------------------------------------------------------------

  /** The comments matching a query, in the order the query asked for. */
  list(input: ListAnnotationsInput): Promise<Annotation[]> {
    return this.dependencies.annotations.list(input);
  }

  /**
   * The comments matching a query, each carrying the reviewer's whole profile.
   *
   * The join is the reason this class exists rather than an argument for it:
   * it reads the annotation service AND the user directory, so no door holding
   * one of them could ever answer it, and the door that held both did the join
   * itself in five places.
   */
  async listWithFullUsers(input: ListAnnotationsInput): Promise<AnnotationWithFullUser[]> {
    const annotations = await this.dependencies.annotations.list(input);
    const profiles = await this.profilesFor(annotations);
    return annotations.map((annotation) => ({
      ...annotation,
      user: this.authorOf(annotation, profiles),
    }));
  }

  /** The same query, carrying only what an avatar and a name need. */
  async listWithUserSummaries(
    input: ListAnnotationsInput,
  ): Promise<AnnotationWithUserSummary[]> {
    const annotations = await this.dependencies.annotations.list(input);
    const profiles = await this.profilesFor(annotations);
    return annotations.map((annotation) => {
      const user = this.authorOf(annotation, profiles);
      return {
        ...annotation,
        user: user ? { id: user.id, name: user.name, image: user.image } : null,
      };
    });
  }

  /** Saves one comment, attributed to the reviewer who left it. */
  create(
    input: Omit<CreateAnnotationInput, "userId">,
    by: AnnotationCaller,
  ): Promise<Annotation> {
    return this.dependencies.annotations.create({ ...input, userId: by.id });
  }

  /**
   * Saves one comment left through the public API, where the annotator is a
   * project credential rather than a member of the workspace.
   *
   * The reviewer is null on purpose and not by omission: there is no user to
   * attribute it to, and stamping the key's owner would credit whoever minted
   * the key with words they never wrote. What identity there is travels in
   * `email` on the input, which is the only thing an external annotator hands
   * us. Named apart from {@link create} so a door cannot reach the
   * unattributed write by forgetting an argument.
   */
  createUnattributed(input: Omit<CreateAnnotationInput, "userId">): Promise<Annotation> {
    return this.dependencies.annotations.create({ ...input, userId: null });
  }

  /** Replaces what a comment says. Never what it is about — that is a new comment. */
  update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.dependencies.annotations.update(input);
  }

  /** One comment, refusing when the project has none by that id. */
  getById(input: AnnotationByIdInput): Promise<Annotation> {
    return this.dependencies.annotations.getById(input);
  }

  /**
   * One comment, or null when there is none.
   *
   * Absence is a real answer for the reader that asks by id off a stale list,
   * which is why this exists next to {@link getById} rather than instead of it.
   */
  async tryGetById(input: AnnotationByIdInput): Promise<Annotation | null> {
    try {
      return await this.dependencies.annotations.getById(input);
    } catch (error) {
      if (error instanceof AnnotationNotFoundError) return null;
      throw error;
    }
  }

  /** Removes one comment. */
  delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.dependencies.annotations.delete(input);
  }

  /** The organization the project belongs to. */
  organizationOf(input: AnnotationProjectInput): Promise<string> {
    return this.dependencies.annotations.getProjectOrganizationId(input);
  }

  // -- queues ----------------------------------------------------------------

  /** Refuses a queue configuration naming a member or a score it may not use. */
  assertQueueConfigurationReferences(
    input: AssertQueueConfigurationReferencesInput,
  ): Promise<void> {
    return this.dependencies.annotations.assertQueueConfigurationReferences(input);
  }

  /**
   * Refuses a queue slug the annotation URL space already spends on something
   * else.
   *
   * `/annotations/all`, `/annotations/me` and `/annotations/my-queue` are
   * views, not queues, so a queue that took one of those names would be
   * unreachable at its own address.
   */
  requireUnreservedQueueSlug(slug: string): void {
    if (RESERVED_QUEUE_SLUGS.has(slug)) throw new AnnotationQueueNameReservedError(slug);
  }

  /** The refusal for a name the project already has a queue for. */
  queueNameTaken(slug: string): AnnotationQueueNameTakenError {
    return new AnnotationQueueNameTakenError(slug);
  }

  /** The refusal for an item that is not this reviewer's to finish. */
  queueItemNotFound(queueItemId: string): AnnotationQueueItemNotFoundError {
    return new AnnotationQueueItemNotFoundError(queueItemId);
  }

  // -- score definitions -----------------------------------------------------

  /** Creates a score definition, or replaces an existing one. */
  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    return this.dependencies.annotations.upsertScore(input);
  }

  /** The project's score definitions, all of them or only the pickable ones. */
  listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    return this.dependencies.annotations.listScores(input);
  }

  /** One score definition. */
  getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    return this.dependencies.annotations.getScore(input);
  }

  /** Retires a score definition, or brings it back, without losing its scores. */
  toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    return this.dependencies.annotations.toggleScore(input);
  }

  /** Removes a score definition for good. */
  deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    return this.dependencies.annotations.deleteScore(input);
  }

  private async profilesFor(
    annotations: readonly Annotation[],
  ): Promise<Map<string, UserFullProfile>> {
    const userIds = [
      ...new Set(
        annotations.flatMap((annotation) =>
          annotation.userId === null ? [] : [annotation.userId],
        ),
      ),
    ];
    const profiles = await this.dependencies.users.getProfiles({ userIds });
    return new Map(profiles.map((profile) => [profile.id, profile]));
  }

  private authorOf(
    annotation: Annotation,
    profiles: Map<string, UserFullProfile>,
  ): UserFullProfile | null {
    return annotation.userId ? (profiles.get(annotation.userId) ?? null) : null;
  }
}
