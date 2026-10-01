import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useEffect, useRef } from "react";

import { drawerChrome } from "../../../../behavior/drawer-chrome.store.ts";
import { getTraceDrawer, useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../../../../behavior/trace-edit.store.ts";
import { TRACE_DRAWER_NAME } from "../../../../model/trace-drawer-params.ts";
import { enterTraceEditMode, exitTraceEditMode } from "../utils/trace-edit-mode.ts";

/** The trace the drawer was last open on, so a close can be told from "never opened". */
interface OpenTrace {
  traceId: string;
  occurredAtMs: number | null;
  projectId: string | null;
}

/**
 * Settles what follows from the address naming a trace: the correction state
 * a new trace starts from, the edit session its link asks for, and what a
 * close takes with it. The address is the one truth; nothing is copied from it.
 * Lives at the page level so one mount serves every page the drawer opens over.
 */
export function useTraceDrawerUrlHydrator(): void {
  const { openDrawer, closeDrawer } = useDrawer();
  const isOpen = useTraceDrawer((s) => s.isOpen);
  const traceId = useTraceDrawer((s) => s.traceId);
  const occurredAtMs = useTraceDrawer((s) => s.occurredAtMs);
  const projectId = useTraceDrawer((s) => s.projectId);
  const isEditing = useTraceDrawer((s) => s.isEditing);
  const lastOpen = useRef<OpenTrace | null>(null);
  // Held in a ref rather than as dependencies: both change identity with every
  // query change on the page, and this effect answers to the drawer address alone.
  const drawerRef = useRef({ openDrawer, closeDrawer });
  drawerRef.current = { openDrawer, closeDrawer };

  useEffect(() => {
    if (!isOpen || !traceId) return;
    // Reading the captured trace is a decision about the trace in front of the
    // reader, not a preference: the next one opens corrected. An unsaved correction
    // belongs to the trace it was written against, and a session on the trace
    // being opened survives, so a link straight into edit mode re-enters it.
    useTraceEditStore.getState().setOverlayView("edited");
    useTraceEditStore.getState().dropSessionForOtherTrace(traceId);
  }, [isOpen, traceId]);

  useEffect(() => {
    if (isOpen && traceId) {
      lastOpen.current = { traceId, occurredAtMs, projectId };
      syncEditMode({ traceId, wantsEdit: isEditing });
      return;
    }
    const closed = lastOpen.current;
    if (!closed) return;
    lastOpen.current = null;
    if (keepDrawerForUnsavedEdit({ closed, drawer: drawerRef.current })) return;
    drawerChrome.getState().reset();
    exitTraceEditMode();
  }, [isOpen, traceId, occurredAtMs, projectId, isEditing]);
}

/**
 * Browser history must not throw away work. A link from before the correction was
 * started says nothing about the correction, so following it back would drop an unsaved
 * one with no way to get it back.
 */
function keepDrawerForUnsavedEdit({
  closed,
  drawer,
}: {
  closed: OpenTrace;
  drawer: Pick<ReturnType<typeof useDrawer>, "openDrawer" | "closeDrawer">;
}): boolean {
  const editStore = useTraceEditStore.getState();
  const editingTraceId = editStore.editingTraceId;
  if (editingTraceId === null || editingTraceId !== closed.traceId) return false;
  if (!selectIsTraceEditDirty(editStore)) return false;

  drawer.openDrawer(TRACE_DRAWER_NAME, {
    traceId: editingTraceId,
    ...(closed.occurredAtMs !== null ? { t: String(closed.occurredAtMs) } : {}),
    ...(closed.projectId !== null ? { projectId: closed.projectId } : {}),
    urlParams: { edit: "1" },
  });
  editStore.requestExit(() => {
    drawerChrome.getState().reset();
    exitTraceEditMode();
    // The link was put back to keep the drawer on screen for the question, so
    // taking the answer means taking it out again.
    drawer.closeDrawer();
  });
  return true;
}

/** Brings the edit session in line with what the link asks for. */
function syncEditMode({ traceId, wantsEdit }: { traceId: string; wantsEdit: boolean }): void {
  const editStore = useTraceEditStore.getState();
  const editingTraceId = editStore.editingTraceId;

  if (wantsEdit) {
    // Starting over would drop the drafts, so only a different trace does that.
    if (editingTraceId !== traceId) enterTraceEditMode(traceId);
    return;
  }

  if (editingTraceId === null) return;
  if (!selectIsTraceEditDirty(editStore)) {
    exitTraceEditMode();
    return;
  }
  // The correction stays, so the link has to say so. Leaving the address without
  // `drawer.edit` would keep the edit bar on screen over a link that reads as
  // "not editing", and the next reload would take the work with it unasked.
  if (editingTraceId === traceId) getTraceDrawer().setIsEditing(true);
}
