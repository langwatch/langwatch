/**
 * "Board › Widget" for a pointer a peer kept, lent through `DashboardPointerToken` (§10.1).
 * Each name is a link while it exists and plain text with "(deleted)" once it is gone. While
 * the boards are not known, or Dashboards is not open to the reader, the kept names show.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { DashboardPointerProps } from "@langwatch/analytics-client";
import { Link as ChakraLink, Text } from "@langwatch/design-system/primitives";

import { analyticsApi } from "../../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import {
  keptDashboardPointer,
  type PointerPart,
  resolveDashboardPointer,
} from "../../model/dashboard-pointer.ts";
import {
  DASHBOARDS_FLAG,
  DASHBOARDS_PERMISSION,
  dashboardsAccess,
} from "../../model/dashboards-access.ts";

export function DashboardPointer({ boardId, boardName, widget }: DashboardPointerProps) {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  // Closed to this reader, the area's addresses answer not-found: no link is offered.
  const isOpen =
    !!projectId &&
    dashboardsAccess({
      flag: host.featureFlag(DASHBOARDS_FLAG),
      isSettled: host.isSettled(),
      canView: host.hasPermission(DASHBOARDS_PERMISSION),
    }) === "open";
  const boards = analyticsApi.dashboards.getAll.useQuery({ projectId }, { enabled: isOpen });
  const widgets = analyticsApi.dashboardWidgets.list.useQuery(
    { projectId },
    { enabled: isOpen && widget !== void 0 },
  );

  const pointer = { boardId, boardName, ...(widget ? { widget } : {}) };
  const resolved = isOpen
    ? resolveDashboardPointer({
        pointer,
        boards: boards.data,
        widgets: widgets.data,
        curated: CURATED_BOARDS,
        projectSlug: project?.slug ?? "",
      })
    : keptDashboardPointer(pointer);

  return (
    <>
      <PointerName part={resolved.board} />
      {resolved.widget && (
        <>
          <Text as="span" color="fg.subtle" aria-hidden>
            ›
          </Text>
          <PointerName part={resolved.widget} />
        </>
      )}
    </>
  );
}

function PointerName({ part }: { part: PointerPart }) {
  const host = useAnalyticsHost();
  const { href } = part;
  if (href === void 0) {
    return (
      <Text as="span" truncate maxWidth="full">
        {part.deleted ? `${part.name} (deleted)` : part.name}
      </Text>
    );
  }
  return (
    <ChakraLink
      href={href}
      truncate
      maxWidth="full"
      color="inherit"
      _hover={{ color: "accent.fg", textDecoration: "underline" }}
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
    >
      {part.name}
    </ChakraLink>
  );
}
