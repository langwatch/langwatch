/**
 * A project address's page for a board the reader may not open: the organization area's wording,
 * with the library as the way back, where the organization's flags open the area; else AC183's.
 * Nothing until the flags answer (dashboards-organization-area).
 */

import { useOrganizationLibraryOpen } from "../../behavior/use-organization-library-open.ts";
import { BoardUnavailable, OrganizationBoardUnavailable } from "../blocks/board-unavailable.tsx";

export function ProjectBoardUnavailable() {
  const library = useOrganizationLibraryOpen();
  if (library.isLoading) return null;
  return library.isOpen ? <OrganizationBoardUnavailable /> : <BoardUnavailable />;
}
