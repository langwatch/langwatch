/**
 * The two project overlays this family serves.
 *
 * A SEPARATE ENTRY FROM THE FAMILY'S OTHER DRAWERS on purpose. `createTeam` and
 * `inviteMember` were always this package's and only ever needed publishing;
 * these two came back from `platform/app` in the ownerless-surfaces sweep, and
 * keeping the two sets on their own entries is what lets each land without
 * waiting on the other.
 *
 * `createProject` has three openers and only two of them are ours — the Teams
 * page and the team form — while the third is `@langwatch/api-key-web`'s
 * CLI-auth screen. That is why the drawers are published rather than mounted
 * from this package: the address is the contract, and the application decides
 * what answers it.
 */

export { CreateProjectDrawer } from "./create-project-drawer";
export { EditProjectDrawer } from "./edit-project-drawer";
