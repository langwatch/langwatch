/**
 * The two project overlays, mounted in the organization host (both live in
 * `@langwatch/organization-web` and share its tRPC cache). Registered from
 * `features/project`: recovery entry in ownerless-ui-surfaces-census.md.
 */

import {
  CreateProjectDrawer as CreateProject,
  EditProjectDrawer as EditProject,
} from "@langwatch/organization-web/drawers/project";

import { fromDrawerAddress } from "../../../drawers";
import { withHost } from "../../../../ui/sections/ui-page";
import { OrganizationHost } from "../../../organization/ui/sections/organization-host";

export const CreateProjectDrawer = withHost(OrganizationHost, fromDrawerAddress(CreateProject));

export const EditProjectDrawer = withHost(OrganizationHost, fromDrawerAddress(EditProject));
