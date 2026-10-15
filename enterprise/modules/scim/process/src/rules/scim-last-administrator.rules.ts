// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { CannotRemoveLastAdminError } from "@langwatch/organization-contract";

/**
 * Refuses a removal that would leave no administrator able to sign in. Only an
 * active administrator can be the last one; everyone else is free to go.
 */
export function assertRemovalKeepsAnAdministrator({
  administrators,
  userId,
}: {
  administrators: readonly string[];
  userId: string;
}): void {
  if (!administrators.includes(userId)) return;
  if (administrators.some((administrator) => administrator !== userId)) return;

  throw new CannotRemoveLastAdminError();
}
