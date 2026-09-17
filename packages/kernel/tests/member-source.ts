import type { MemberSource } from "../src/module-members.ts";

/**
 * A member source over a plain record, for tests that name their own members.
 */
export function memberSourceOf<Members extends object>(members: Members): MemberSource<Members> {
  const order = Object.keys(members) as (keyof Members & string)[];
  return {
    order,
    read<Name extends keyof Members & string>(name: Name): Members[Name] {
      const value = members[name];
      if (value === void 0) throw new Error(`This process has no "${name}" member.`);
      return value;
    },
    close: () => Promise.resolve(),
  };
}
