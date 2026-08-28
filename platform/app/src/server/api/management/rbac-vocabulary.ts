/**
 * This process's permission vocabulary, as the packaged roles family reads it.
 *
 * The lists themselves live in `~/utils/rbacVocabulary` — the leaf module both
 * halves of the app share — and the organization-exclusive rule in
 * `~/server/api/rbac`. Neither can move behind `@langwatch/platform-api`: the
 * first is read by the settings UI, and the second sits on top of the RBAC
 * engine. So the three facts the `/api/roles` catalog and its validator need
 * are handed over here, and the package derives everything it publishes from
 * them.
 *
 * The published order is the order stated here, which is the declaration order
 * in the vocabulary: a caller rendering a permission picker from the document
 * sees what the settings UI shows.
 */
import type { AppRestRbacVocabulary } from "@langwatch/platform-api/app-rest";

import { isOrgExclusivePermission, type Permission } from "~/server/api/rbac";
import { Actions, Resources } from "~/utils/rbacVocabulary";

export const appRestRbacVocabulary: AppRestRbacVocabulary = {
  actions: Object.values(Actions),
  resources: Object.values(Resources),
  // The legacy hand-kept org-exclusive set, asked the way the catalog asked
  // it: a resource is exclusive when its `view` permission is. Deliberately
  // NOT the registry's `bindingScopeCanGrantPermission`, which knows a wider
  // set — swapping them would change what this endpoint publishes.
  isOrganizationExclusive: (resource) => isOrgExclusivePermission(`${resource}:view` as Permission),
};
