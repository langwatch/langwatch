// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";

/**
 * The user module as NurturingService reads addresses: each person's is `<userId>@example.com`
 * unless `emails` names it (null: no address). Each lookup's ids land in `reads`, when given.
 */
export function peopleWithEmails({
  emails = {},
  reads,
}: {
  emails?: Readonly<Record<string, string | null>>;
  reads?: string[][];
} = {}): UserApi {
  return createApiFixture<UserApi>({
    getProfiles: async ({ userIds }) => {
      reads?.push([...userIds]);
      return userIds.map((id) =>
        profileOf({ id, email: id in emails ? (emails[id] ?? null) : `${id}@example.com` }),
      );
    },
  });
}

function profileOf({ id, email }: { id: string; email: string | null }): UserFullProfile {
  return {
    id,
    name: null,
    email,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}
