/** The organization drawers, mounted in the host their package asks for; both need `fromDrawerAddress`'s `open` coercion (see its docstring). */

import {
  CreateTeamDrawer as CreateTeam,
  InviteMemberDrawer as InviteMember,
} from "@langwatch/organization-web/drawers";

import { fromDrawerAddress } from "../../../drawers";
import { withHost } from "../../../../ui/sections/ui-page";
import { OrganizationHost } from "./organization-host";

export const InviteMemberDrawer = withHost(OrganizationHost, fromDrawerAddress(InviteMember));

export const CreateTeamDrawer = withHost(OrganizationHost, fromDrawerAddress(CreateTeam));
