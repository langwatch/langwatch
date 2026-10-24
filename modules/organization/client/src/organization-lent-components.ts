/**
 * Organization's lent tokens as ready components: a borrower imports these and writes no wrapper
 * (§10.1). Its own entry point, so typing a module's procedures never loads the host's lent code.
 */
import { lentComponent } from "@langwatch/browser-host/lent";

import { PendingJoinRequestsToken, ProjectDepartmentFieldToken } from "./organization-lent.ts";

export const PendingJoinRequests = lentComponent(PendingJoinRequestsToken);
export const ProjectDepartmentField = lentComponent(ProjectDepartmentFieldToken);
