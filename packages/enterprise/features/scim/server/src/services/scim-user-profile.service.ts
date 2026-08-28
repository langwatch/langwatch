// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuthService } from "@langwatch/auth-contract";
import type { UpdateUserProfileInput, UserProfile, UserService } from "@langwatch/user-contract";

/** Coordinates the session boundary that follows a SCIM-managed email change. */
export class ScimUserProfileService {
  private constructor(
    private readonly users: UserService,
    private readonly auth: AuthService,
  ) {}

  static create(options: { users: UserService; auth: AuthService }): ScimUserProfileService {
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
