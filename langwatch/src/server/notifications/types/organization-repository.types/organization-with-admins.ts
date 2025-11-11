import type { OrganizationAdmin } from "./organization-admin";

/**
 * Organization with admin members
 */
export interface OrganizationWithAdmins {
  id: string;
  name: string;
  admins: OrganizationAdmin[];
}

