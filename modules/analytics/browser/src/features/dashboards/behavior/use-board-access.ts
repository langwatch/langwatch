/**
 * Who is reading the boards and from where, and the names sentences about a board's scope
 * use: what the host knows of the member, their role in this project and the organization.
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  boardAccess,
  type BoardAccess,
  type BoardReader,
  ORGANIZATION_FALLBACK_NAME,
  type ScopedBoard,
  type ScopeNames,
} from "../model/board-scope.ts";

export function useBoardReader(): BoardReader & { organizationName: string; projectName: string } {
  const host = useAnalyticsHost();
  const project = host.project();
  return {
    projectId: project?.id ?? "",
    projectName: project?.name ?? "",
    organizationId: host.organizationId(),
    organizationName: host.organizationName() ?? ORGANIZATION_FALLBACK_NAME,
    userId: host.userId(),
    mayCreate: host.hasPermission("analytics:create"),
    mayEdit: host.hasPermission("analytics:update"),
    mayDelete: host.hasPermission("analytics:delete"),
  };
}

/** What the member may do with one board here, and the names its scope is spoken with. */
export function useBoardAccess(board: ScopedBoard & { ownerProject: { name: string } | null }): {
  access: BoardAccess;
  names: ScopeNames;
} {
  const reader = useBoardReader();
  return {
    access: boardAccess({ board, reader }),
    names: {
      project: board.ownerProject?.name ?? reader.projectName,
      organization: reader.organizationName,
    },
  };
}
