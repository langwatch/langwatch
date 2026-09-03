/**
 * The two project overlays, mounted in the host their package asks for.
 *
 * A DRAWER IS NOT A PAGE. The Teams page is wrapped in `withOrganizationHost`
 * by the route it answers; these two open OVER whatever address the reader is
 * on — `createProject` is opened from the Teams page, from the team form, and
 * from the CLI-auth screen, which is a different family's page entirely — so
 * the host travels with the drawer rather than with the address.
 *
 * THE HOST IS THE ORGANIZATION HOST, and it is imported across features rather
 * than duplicated. Both drawers live in `@langwatch/organization-web`, ask that
 * package's `useOrganizationTeamProject`, `useDrawer` and toaster, and read the
 * organization graph through its transport; a port of this family's own would
 * split the tRPC cache and leave those hooks asking a host nothing mounted. The
 * experiments family mounts the workflow host across the same seam, for the
 * same reason.
 *
 * WHY THEY ARE REGISTERED FROM `features/project` RATHER THAN FROM
 * `features/organization`, given the package they come from: the organization
 * feature's registry is the two overlays that family has always owned
 * (`inviteMember`, `createTeam`), which were published rather than recovered.
 * These two came back from `platform/app` — deleted in `cc91631cd8`, recorded
 * as group (c) in `dev/docs/plans/ownerless-ui-surfaces-census.md` — and
 * keeping the recovery on its own entry is what let it land without waiting on
 * that publication.
 *
 * THE ADDRESS'S `open` IS COERCED, and here that is load-bearing rather than
 * defensive: both components default `open` to `true` and hand it straight to
 * Chakra's `Drawer.Root`, so the parsed address — where `open` is the string
 * `"createProject"` — would otherwise reach a control that accepts only a
 * boolean and render the drawer closed against an address that says it is open.
 */

import {
  CreateProjectDrawer as CreateProject,
  EditProjectDrawer as EditProject,
} from "@langwatch/organization-web/drawers/project";

import { fromDrawerAddress } from "../../../drawers";
import { withOrganizationHost } from "../../../organization/ui/sections/organization-host-provider";

export const CreateProjectDrawer = withOrganizationHost(fromDrawerAddress(CreateProject));

export const EditProjectDrawer = withOrganizationHost(fromDrawerAddress(EditProject));
