/**
 * A grant as the Roles tab folds it into counts and holders. The shape is
 * `@langwatch/authz-contract`'s own {@link AuthzManagedOrganizationBinding}.
 */

import type { WireOf } from "@langwatch/api/web";
import type { AuthzManagedOrganizationBinding } from "@langwatch/authz-contract";

/** A grant as the browser holds one: the wire carries `createdAt` as a string. */
export type ManagedGrant = WireOf<AuthzManagedOrganizationBinding>;
