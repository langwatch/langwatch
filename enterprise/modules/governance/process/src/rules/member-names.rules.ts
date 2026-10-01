// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

type Member = { userId: string; user: { name: string | null; email: string | null } };

/** Main's `findMemberNames`: the display name, else the address, else nothing. */
export function memberNames(members: readonly Member[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const member of members) {
    const name = member.user.name ?? member.user.email;
    if (name) names.set(member.userId, name);
  }
  return names;
}
