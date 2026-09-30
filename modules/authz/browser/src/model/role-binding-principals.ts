/**
 * A binding as the Roles tab folds it into counts and holders. The shape is
 * `@langwatch/authz-contract`'s own {@link AuthzManagedOrganizationBinding}.
 */

import type { WireOf } from "@langwatch/api/web";
import type { AuthzManagedOrganizationBinding } from "@langwatch/authz-contract";

/** A binding as the browser holds one: the wire carries `createdAt` as a string. */
export type RoleBinding = WireOf<AuthzManagedOrganizationBinding>;
