/**
 * UserAvatarService — sets and clears a user's uploaded avatar.
 *
 * Flow for `setAvatar`:
 *   1. Validate + decode the client's base64 image (pure, in `avatar.ts`).
 *   2. Resolve the user's personal-workspace project (idempotent `ensure`) —
 *      the tenant the avatar bytes are stored under. The avatar is user-owned
 *      identity, so it lives under the user's own project, not any shared one.
 *   3. Store the bytes via the content-addressed stored-objects service, tagged
 *      with the `user_avatar` purpose and a user owner.
 *   4. Persist the same-origin serve URL to `User.image` — the single field
 *      every avatar surface already resolves through.
 *
 * `removeAvatar` simply clears `User.image` (bytes are content-addressed and
 * may be shared via dedup, so they are not eagerly deleted).
 *
 * SSO precedence: better-auth writes `User.image` only on user *create* (via
 * `mapProfileToUser`), never on re-login — no provider opts into overwriting
 * profile info on sign-in — so an uploaded photo is never clobbered by a later
 * SSO sign-in. No guard is needed here; that "no override-on-sign-in" invariant
 * is locked by better-auth/__tests__/index.test.ts and specified in
 * specs/settings/user-avatar.feature.
 *
 * Collaborators are injected (with production defaults) so the orchestration is
 * unit-testable without ClickHouse or the EE workspace service.
 *
 * Spec: specs/settings/user-avatar.feature
 */

import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import type { PrismaClient } from "@prisma/client";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import {
  AVATAR_OWNER_KIND,
  AVATAR_PURPOSE,
  buildAvatarUrl,
  parseAvatarDataUrl,
} from "./avatar";

/** Resolves (creating if needed) the personal project the avatar is stored under. */
type EnsureWorkspaceProject = (args: {
  userId: string;
  organizationId: string;
  displayName?: string | null;
  displayEmail?: string | null;
}) => Promise<{ projectId: string }>;

/** Stores avatar bytes and returns the content-addressed object id. */
type StoreAvatarBytes = (args: {
  projectId: string;
  userId: string;
  mediaType: string;
  bytes: Buffer;
}) => Promise<{ id: string }>;

interface UserAvatarServiceDeps {
  ensureWorkspaceProject?: EnsureWorkspaceProject;
  storeAvatarBytes?: StoreAvatarBytes;
}

export class UserAvatarService {
  private readonly ensureWorkspaceProject: EnsureWorkspaceProject;
  private readonly storeAvatarBytes: StoreAvatarBytes;

  constructor(
    private readonly prisma: PrismaClient,
    deps: UserAvatarServiceDeps = {},
  ) {
    this.ensureWorkspaceProject =
      deps.ensureWorkspaceProject ??
      (async (args) => {
        const workspace = await new PersonalWorkspaceService(
          this.prisma,
        ).ensure({
          userId: args.userId,
          organizationId: args.organizationId,
          displayName: args.displayName ?? undefined,
          displayEmail: args.displayEmail ?? undefined,
        });
        return { projectId: workspace.project.id };
      });

    this.storeAvatarBytes =
      deps.storeAvatarBytes ??
      (async ({ projectId, userId, mediaType, bytes }) => {
        const stored = await createStoredObjectsService({
          projectId,
        }).storeFromBytes({
          projectId,
          purpose: AVATAR_PURPOSE,
          ownerKind: AVATAR_OWNER_KIND,
          ownerId: userId,
          mediaType,
          bytes,
        });
        return { id: stored.id };
      });
  }

  /**
   * Validates, stores, and sets the user's uploaded avatar. Returns the new
   * `User.image` URL.
   *
   * @throws {AvatarValidationError} for a caller-fixable payload problem.
   */
  async setAvatar({
    userId,
    organizationId,
    imageDataUrl,
    displayName,
    displayEmail,
  }: {
    userId: string;
    organizationId: string;
    imageDataUrl: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }): Promise<{ image: string }> {
    const { mediaType, bytes } = parseAvatarDataUrl(imageDataUrl);

    const { projectId } = await this.ensureWorkspaceProject({
      userId,
      organizationId,
      displayName,
      displayEmail,
    });

    const { id } = await this.storeAvatarBytes({
      projectId,
      userId,
      mediaType,
      bytes,
    });

    const image = buildAvatarUrl({ projectId, id });
    await this.prisma.user.update({ where: { id: userId }, data: { image } });
    return { image };
  }

  /** Clears the user's avatar so surfaces fall back to SSO photo → initials. */
  async removeAvatar({ userId }: { userId: string }): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { image: null },
    });
  }
}
