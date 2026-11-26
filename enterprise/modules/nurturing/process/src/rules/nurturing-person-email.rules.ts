// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

/** The people whose Customer.io profile these calls may create: identify and track name one. */
export function personUserIdsOf(calls: readonly CioBatchCall[]): string[] {
  const userIds = calls.flatMap((call) => (call.type === "group" ? [] : [call.userId]));
  return [...new Set(userIds)];
}

/**
 * A profile born without an email fails every email automation, so each identify carries the
 * person's current address. A track would create a missing profile too, so it goes behind an
 * identify that carries the address; a person with no address gets neither.
 */
export function withPersonEmails({
  calls,
  emails,
}: {
  calls: readonly CioBatchCall[];
  emails: ReadonlyMap<string, string>;
}): CioBatchCall[] {
  const identified = new Set<string>();
  return calls.flatMap((call): CioBatchCall[] => {
    if (call.type === "group") return [call];
    const email = emails.get(call.userId);
    if (!email) return [];
    const firstOfPerson = !identified.has(call.userId);
    identified.add(call.userId);
    if (call.type === "identify") return [{ ...call, traits: { ...call.traits, email } }];
    return firstOfPerson
      ? [{ type: "identify", userId: call.userId, traits: { email } }, call]
      : [call];
  });
}
