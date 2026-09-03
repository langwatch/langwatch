/**
 * The organization drawers, mounted in the host their package asks for.
 *
 * A DRAWER IS NOT A PAGE. The Members and Teams screens are wrapped in
 * `withOrganizationHost` by the route they answer; these two open OVER whatever
 * address the reader is on — the command palette opens `inviteMember` from
 * anywhere in the product — so the host travels with the drawer rather than
 * with the address. Both read it: the invite form asks for the organization,
 * the reader's grants and whether the deployment can send mail, and the team
 * form asks for the organization and the signed-in user.
 *
 * THE ADDRESS'S `open` IS COERCED, and here that is load-bearing rather than
 * defensive. Both components default `open` to `true` and hand it straight to
 * Chakra's `Drawer.Root`, so the parsed address — where `open` is the string
 * `"inviteMember"` — would otherwise reach a control that accepts only a
 * boolean.
 */

import {
  CreateTeamDrawer as CreateTeam,
  InviteMemberDrawer as InviteMember,
} from "@langwatch/organization-web/drawers";

import { fromDrawerAddress } from "../../../drawers";
import { withOrganizationHost } from "./organization-host-provider";

export const InviteMemberDrawer = withOrganizationHost(fromDrawerAddress(InviteMember));

export const CreateTeamDrawer = withOrganizationHost(fromDrawerAddress(CreateTeam));
