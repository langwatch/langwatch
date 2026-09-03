import { useMemo } from "react";
import { useDrawerStore } from "../../../../index";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import type { PresenceLocation } from "@langwatch/presence-contract";
import { selectMostVisibleSection, useSectionTrackerStore } from "@langwatch/presence-web";
import { usePresence } from "./use-presence";
import { usePresenceFeatureEnabled } from "../../../../behavior/presence/use-presence-feature-enabled";

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
  const { enabled: featureEnabled } = usePresenceFeatureEnabled();

  const isOpen = useDrawerStore((s) => s.isOpen);
  const traceId = useDrawerStore((s) => s.traceId);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const viewMode = useDrawerStore((s) => s.viewMode);
  const vizTab = useDrawerStore((s) => s.vizTab);
  const section = useSectionTrackerStore(selectMostVisibleSection);

  const location = useMemo<PresenceLocation>(() => {
    const route: PresenceLocation["route"] = {
      traceId: isOpen ? (traceId ?? null) : null,
      spanId: isOpen ? (selectedSpanId ?? null) : null,
    };
    if (!isOpen) {
      return { lens: "traces", route };
    }
    // PresenceLocation's shared schema only knows about the pre-redesign
    // modes ("trace" | "conversation" | "scenario"). The new "summary"
    // viewMode collapses back to "trace" at the wire so peers running
    // older code still see the user as "on the trace" — losing only the
    // distinction between the trace surface and the standalone summary
    // mode (which is a UI affordance, not a separate location). `tab`
    // is dropped now that SpanTabBar carries only span-scope tabs; the
    // selected span is already captured via `route.spanId`.
    const wireMode: "trace" | "conversation" =
      viewMode === "conversation" ? "conversation" : "trace";
    const view: NonNullable<PresenceLocation["view"]> = {
      mode: wireMode,
      panel: vizTab,
      ...(section ? { section } : {}),
    };
    return { lens: "traces", route, view };
  }, [isOpen, traceId, selectedSpanId, viewMode, vizTab, section]);

  usePresence({
    projectId,
    location,
    enabled: Boolean(projectId) && featureEnabled,
  });
}
