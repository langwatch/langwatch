import type { MemberSource } from "../src/module-members.ts";

/**
 * A member source over a plain record, for a test that names its own members.
 *
 * It is the same seam `@langwatch/infrastructure` implements: `order` is every
 * member this source can build, and a name outside it is a member this process
 * cannot supply, which is what boot refuses on. A key present with the value
 * `undefined` is the other failure - a member that was meant to be built and
 * is not - and it throws where it is read.
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
