/**
 * Whether one caller holds one permission on one project.
 *
 * A suggested output rewrites the trace itself, so the annotation door carries
 * it over only for a caller who may also update annotations. The declared check
 * on the procedure covers the comment; this probe covers the correction. The
 * process owns the permission service, so it owns this port.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";

export abstract class AnnotationPermissionPort {
  abstract hasProjectPermission(
    input: Readonly<{ userId: string; projectId: string; permission: AuthzPermission }>,
  ): Promise<boolean>;
}
