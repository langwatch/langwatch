import type { PresenceLocation } from "@langwatch/presence-contract";
import { useMemo } from "react";

import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import {
  pickMostVisibleSection,
  useSectionTrackerStore,
} from "../../../../behavior/presence/section-tracker-store.ts";
import { usePresenceFeatureEnabled } from "../../../../behavior/presence/use-presence-feature-enabled.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { usePresence } from "./use-presence.ts";

/**
 * Drives the multiplayer presence channel from traces-v2 page state.
 */
export function useTracesPresence(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;
  const { enabled: featureEnabled } = usePresenceFeatureEnabled();

  const isOpen = useTraceDrawer((s) => s.isOpen);
  const traceId = useTraceDrawer((s) => s.traceId);
  const selectedSpanId = useTraceDrawer((s) => s.selectedSpanId);
  const viewMode = useTraceDrawer((s) => s.viewMode);
  const vizTab = useTraceDrawer((s) => s.vizTab);
  const section = useSectionTrackerStore(pickMostVisibleSection);

  const location = useMemo<PresenceLocation>(() => {
    const route: PresenceLocation["route"] = {
      traceId: isOpen ? (traceId ?? null) : null,
      spanId: isOpen ? (selectedSpanId ?? null) : null,
    };
    if (!isOpen) {
      return { lens: "traces", route };
    }
    // PresenceLocation's shared schema only knows about the pre-redesign modes ("trace"
    // | "conversation" | "scenario").
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
