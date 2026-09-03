/**
 * The avatar family's object read, over the stored-object application this
 * process already composed.
 *
 * A bridge in the PROCESS rather than a dependency between two feature server
 * packages: `user` is a core feature and the content-addressed store belongs to
 * the stored-object vertical, and neither package may reach the other. It is
 * the same seam `ApiTraceMediaStore` occupies for the write direction.
 *
 * What this exists to carry is the OWNER KIND. `/api/user-avatar` authorizes
 * any authenticated caller on the platform, and the only thing standing between
 * that and one tenant pulling another's trace media is the family's refusal of
 * every object whose purpose and owner kind are not the avatar ones. This
 * process's file read used to answer a row that named the purpose and not the
 * owner kind, which is why the family was left unmounted; the row carries both
 * columns now, and this adapter is where they become the metadata the family
 * checks.
 *
 * Spec: specs/settings/user-avatar-upload.feature
 */
import type { StoredObjectApp } from "@langwatch/stored-object-server";
import type { UserAvatarObjectReader, UserAvatarStoredObjectRead } from "@langwatch/user-server";

/**
 * Builds the reader the family takes, resolved per request.
 *
 * The application arrives as a thunk for the reason every packaged family's
 * services do: mounting must not force a service to be constructed, which is
 * what lets the route-registry audits and the OpenAPI generator build the
 * family with no running process.
 */
export function createApiUserAvatarObjectReader(
  storedObjects: () => StoredObjectApp,
): UserAvatarObjectReader {
  return {
    async getById(input: { projectId: string; id: string }): Promise<UserAvatarStoredObjectRead> {
      const result = await storedObjects().readById(input);
      if (!result) return null;

      const metadata = {
        byteLength: result.row.size_bytes,
        mediaType: result.row.media_type,
        purpose: result.row.purpose,
        ownerKind: result.row.owner_kind,
      };

      // `status: "missing"` is the row without its bytes. The family refuses
      // it the same way it refuses a foreign object, but it still needs the
      // metadata to have been read — the gate runs before the status does.
      if (!("stream" in result)) return { status: "missing", metadata };

      return { status: "available", metadata, stream: result.stream };
    },
  };
}
