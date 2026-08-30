// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuthService } from "@langwatch/auth-contract";
import type { UpdateUserProfileInput, UserProfile, UserService } from "@langwatch/user-contract";

/**
 * The one thing SCIM asks of Auth: drop a user's sessions after their email
 * changes underneath them. Named here, where the call is, so the chain that
 * carries it down from `ScimService` states the same narrow dependency at every
 * step rather than passing a whole `AuthService` to reach one method.
 */
export type ScimSessionRevocation = Pick<AuthService, "revokeAllBrowserSessions">;

/**
 * The two user reads and writes a SCIM profile update needs: the previous
 * profile, to see whether the email moved, and the write itself.
 */
export type ScimUserProfileReadWrite = Pick<UserService, "tryFindById" | "updateProfile">;

/** Coordinates the session boundary that follows a SCIM-managed email change. */
export class ScimUserProfileService {
  private constructor(
    private readonly users: ScimUserProfileReadWrite,
    private readonly auth: ScimSessionRevocation,
  ) {}

  static create(options: {
    users: ScimUserProfileReadWrite;
    auth: ScimSessionRevocation;
  }): ScimUserProfileService {
    return new ScimUserProfileService(options.users, options.auth);
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const previous =
      input.email === undefined ? null : await this.users.tryFindById({ id: input.id });
    const updated = await this.users.updateProfile(input);

    if (
      previous &&
      input.email !== undefined &&
      (previous.email ?? "").toLowerCase() !== updated.email
    ) {
      await this.auth.revokeAllBrowserSessions({ userId: input.id });
    }

    return updated;
  }
}
