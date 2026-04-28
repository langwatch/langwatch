import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawerStore } from "~/features/traces-v2/stores/drawerStore";
import type { PresenceLocation } from "~/server/app-layer/presence/types";
import {
  selectMostVisibleSection,
  useSectionTrackerStore,
} from "../stores/sectionTrackerStore";
import { usePresence } from "./usePresence";

/**
 * Drives the multiplayer presence channel from traces-v2 page state.
 *
 * Mounted as a sibling component inside the traces page so it can listen to
 * the drawer/store transitions without forcing the page itself to know about
 * presence. The derived {@link PresenceLocation} captures the lens, the
 * currently-open trace/conversation/span, and the active drawer view/panel/tab.
 */
export function useTracesV2Presence(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;

  const isOpen = useDrawerStore((s) => s.isOpen);
  const traceId = useDrawerStore((s) => s.traceId);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const viewMode = useDrawerStore((s) => s.viewMode);
  const vizTab = useDrawerStore((s) => s.vizTab);
  const activeTab = useDrawerStore((s) => s.activeTab);
  const section = useSectionTrackerStore(selectMostVisibleSection);

  const location = useMemo<PresenceLocation>(() => {
    const route: PresenceLocation["route"] = {
      traceId: isOpen ? traceId ?? null : null,
      spanId: isOpen ? selectedSpanId ?? null : null,
    };
    if (!isOpen) {
      return { lens: "traces", route };
    }
    const view: NonNullable<PresenceLocation["view"]> = {
      mode: viewMode,
      panel: vizTab,
      tab: activeTab,
      ...(section ? { section } : {}),
    };
    return { lens: "traces", route, view };
  }, [isOpen, traceId, selectedSpanId, viewMode, vizTab, activeTab, section]);

  usePresence({
    projectId,
    location,
    enabled: Boolean(projectId),
  });
}
