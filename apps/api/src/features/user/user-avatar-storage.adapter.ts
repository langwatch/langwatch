/**
 * The avatar family's object WRITE, over the content-addressed store this
 * process already composed.
 *
 * The twin of `createApiUserAvatarObjectReader`, and a bridge in the PROCESS
 * for the same reason: `user` is a core feature and the content-addressed
 * store belongs to the stored-object vertical, and neither package may reach
 * the other. It is the seam `ApiTraceMediaStore` occupies for trace media.
 *
 * What this exists to carry is the OWNER KIND and the PURPOSE. `/api/user-avatar`
 * authorizes any authenticated caller on the platform and serves an object only
 * when both are the avatar ones, so a write that stamped either differently
 * would produce a photo the route then refuses to serve. They are read from the
 * same two constants the route compares against, so the two halves cannot drift.
 *
 * The store is `StoredObjectsService` — the `storedObjectBytes` half of the
 * product-infrastructure record — rather than `StoredObjectApp`, because the
 * application exposes no byte write: its portable half refuses by name on this
 * process. It is the SAME instance the application reads through (`files`), so
 * an avatar written here is an avatar `StoredObjectApp.readById` finds, and the
 * upload door and `/api/files` still hash one object once.
 *
 * Spec: specs/settings/user-avatar-upload.feature (the upload),
 * specs/server/api-process-auth.feature (the refusal).
 */
import type { StoredObjectsService } from "@langwatch/stored-object-server";
import {
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  UserAvatarTooLargeError,
  type UserAvatarMediaType,
} from "@langwatch/user-contract";
import { UserAvatarStoragePort } from "@langwatch/user-server";

/**
 * The one operation an avatar write performs on the content-addressed store.
 *
 * Narrowed rather than taking the whole service because that is honestly all
 * this adapter reaches for, and because a narrowed seam is one a test can stand
 * a real double in front of instead of casting a half-built service into place.
 * The process's `storedObjectBytes` satisfies it structurally.
 */
export type ApiUserAvatarObjectWriter = Pick<StoredObjectsService, "storeFromBytes">;

/**
 * Stores an uploaded avatar as one content-addressed object.
 *
 * The store arrives as a thunk for the reason every packaged family's services
 * do, and for one more that is specific to this seam: the Auth graph — and the
 * user service under it — is composed BEFORE the product-infrastructure half,
 * because the browser-session boundary is what every other door stands on. A
 * store read at composition time would therefore always be absent. It is read
 * at the upload instead, which is the only moment it is needed.
 */
export class ApiUserAvatarStorageAdapter extends UserAvatarStoragePort {
  static create(options: {
    /** The content-addressed store, resolved at the upload rather than at composition. */
    storedObjects: () => ApiUserAvatarObjectWriter | undefined;
    /** Names the process in the refusal, so a stack trace says whose gap this is. */
    processName: string;
  }): ApiUserAvatarStorageAdapter {
    return new ApiUserAvatarStorageAdapter(options.storedObjects, options.processName);
  }

  /**
   * The same adapter on a process that composes no object store at all.
   *
   * It refuses, loudly and by name. A process can compose the user service to
   * READ — the browser-session boundary resolves a signed-in person's stored
   * profile through it — and a read needs no object store. Writing an avatar
   * does.
   *
   * The two alternatives are both worse. Refusing to compose the user service
   * at all would take the browser-session boundary down over a capability it
   * never calls; accepting the bytes and dropping them would answer a
   * customer's upload with success and no picture.
   */
  static absent(options: { processName: string }): ApiUserAvatarStorageAdapter {
    return new ApiUserAvatarStorageAdapter(() => undefined, options.processName);
  }

  private constructor(
    private readonly storedObjects: () => ApiUserAvatarObjectWriter | undefined,
    private readonly processName: string,
  ) {
    super();
  }

  async store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const storedObjects = this.storedObjects();
    if (!storedObjects) {
      // A plain `Error` on purpose. Nothing the caller sends causes it and
      // nothing they can send avoids it — it is a fact about which tier is
      // serving them — so it degrades to a generic failure carrying the trace
      // id rather than dressing a deployment shape up as a customer's mistake.
      throw new Error(
        `${this.processName} composes no stored-object application, so it cannot store the avatar uploaded for user "${input.userId}". Upload it through a process that composes stored objects.`,
      );
    }

    // The avatar's own ceiling, restated at the store.
    //
    // The upload's codec already refuses an oversized image, so this is not
    // the customer-facing check — it is the one the retired platform got from
    // composing a DEDICATED stored-object service with `maximumUploadBytes`
    // set to this constant. This process shares one content-addressed store
    // with trace media, whose ceiling is much larger, so the avatar ceiling
    // has to travel with the avatar write or it does not exist at all.
    if (input.bytes.byteLength > USER_AVATAR_MAX_BYTES) {
      throw new UserAvatarTooLargeError();
    }

    const stored = await storedObjects.storeFromBytes({
      projectId: input.projectId,
      purpose: USER_AVATAR_PURPOSE,
      ownerKind: USER_AVATAR_OWNER_KIND,
      ownerId: input.userId,
      mediaType: input.mediaType,
      bytes: Buffer.from(input.bytes),
    });
    return { id: stored.id };
  }
}
