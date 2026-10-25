// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Turns the user ids on an operator view into names, through the user module's Api. */
import type { UserApi } from "@langwatch/user-contract";

type People = Pick<UserApi, "getProfiles">;

export class PersonNamesService {
  static create(deps: { people: People }): PersonNamesService {
    return new PersonNamesService(deps.people);
  }

  private constructor(private readonly people: People) {}

  /** A name per distinct id: the name, else the address, else null when the person is gone. */
  async namesFor({
    ids,
  }: {
    ids: readonly (string | null)[];
  }): Promise<Map<string, string | null>> {
    const distinct = [...new Set(ids.filter((id): id is string => id !== null))];
    if (distinct.length === 0) return new Map();
    const profiles = await this.people.getProfiles({ userIds: distinct });
    const found = new Map(profiles.map((profile) => [profile.id, profile.name ?? profile.email]));
    return new Map(distinct.map((id) => [id, found.get(id) ?? null]));
  }
}
