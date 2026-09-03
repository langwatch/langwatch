/**
 * The two overlays this family owns, by the name the address uses.
 *
 * SEPARATE FROM `./screens/organization` on purpose, and for the reason that
 * entry states about itself: it publishes SCREENS as loaders, so that a page's
 * whole closure stays out of the chunk the rest of the application renders in.
 * A drawer is loaded on the same terms — the composing application spreads
 * `{ inviteMember, createTeam }` into its registry behind a lazy import — but it
 * is not a page, it has no route, and it opens over whatever address the reader
 * is already on.
 *
 * BOTH WERE ADDRESSED AND UNPUBLISHED. `members.screen.tsx` writes
 * `openDrawer("inviteMember")` from the header button and from the inline
 * invite box, `teams.screen.tsx` writes `openDrawer("createTeam")`, and the
 * command palette writes the first of them too — and neither component was
 * exported, so `CurrentDrawer` looked the name up, missed, and rendered
 * nothing. What each still needs from the application is the
 * `OrganizationHostProvider` the screens are already mounted inside: these
 * drawers read the organization, the reader and the deployment's mail
 * capability off that port.
 */

export { CreateTeamDrawer } from "../ui/sections/create-team-drawer";
export { InviteMemberDrawer } from "../ui/sections/invite-member-drawer";
