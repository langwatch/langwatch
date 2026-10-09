/**
 * The one directory row auth reads as its own: the person a device grant names. Organizations,
 * memberships and projects are asked of their owners (services/cli-device-directory.service.ts).
 */
export abstract class AuthDirectoryRepository {
  /** Throws `UserNotFoundError`. */
  abstract getPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null }>;
}
