/**
 * A new board before anything is stored: "+" or the "New dashboard" dialog opens it at `new`, and
 * its first edit (a widget, a name, a description, a pin or a scope) stores it, once, however
 * many edits race. Leaving it unedited stores nothing. Failures travel raw to the host (#5984).
 * @see modules/dashboard/specs/dashboards-v2.feature AC162
 */

import { type UiAnalytics, useUiAnalytics } from "@langwatch/browser-host/analytics";
import { defineSlice } from "@langwatch/browser-host/global-store";
import type {
  DashboardHomeProduct,
  DashboardProject,
  DashboardScope,
} from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { type AnalyticsHostApi, useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  dashboardsPath,
  draftBoardPath,
  DRAFT_SEGMENT,
  ORGANIZATION_DASHBOARDS_PATH,
  organizationBoardPath,
  untitledBoardName,
  withQueryString,
} from "../model/boards.ts";
import { dashboardCreated } from "../model/dashboard-usage-events.ts";
import { WIDGET_PICKER_QUERY_KEY, withBlockPickerOpen } from "./use-block-picker-address.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/**
 * What a draft's first edit, or one made while it is being stored, carries. `templateId`: the
 * template the edit applies, which the stored board's product event names.
 */
export type DraftEdit = {
  name?: string;
  description?: string | null;
  pin?: boolean;
  templateId?: string;
};

/** Where a draft lives and what it is stored as; the dialog picks them, "+" takes defaults. */
type DraftFrame = {
  homeProduct: DashboardHomeProduct;
  scope: DashboardScope;
  /** Opened in Dashboards (`/dashboards/new`), so it stays there once stored. */
  atOrganization: boolean;
  /** The project it is stored in, which Dashboards runs the board screen in. */
  project: DashboardProject | undefined;
};

const PROJECT_FRAME: DraftFrame = {
  homeProduct: "llm-ops",
  scope: "PROJECT",
  atOrganization: false,
  project: void 0,
};

type DraftState = DraftFrame & {
  /** Bumped by every "+", so a new draft never inherits the screen of the last one. */
  generation: number;
  projectId: string | undefined;
  name: string | undefined;
  description: string | null;
  pin: boolean;
  /** The board this draft became, once stored. */
  savedId: string | undefined;
  /** The one store in flight, then each edit queued on it; every edit waits on the last. */
  saving: Promise<string> | undefined;
  /** The last store was refused: what the draft shows is not stored, so sending it again counts. */
  refused: boolean;
};

const FRESH = {
  name: void 0,
  description: null,
  pin: false,
  savedId: void 0,
  saving: void 0,
  refused: false,
} as const;

const useDraftStore = defineSlice<DraftState>({
  name: "analytics:dashboard-draft",
  create: () => ({ generation: 0, projectId: void 0, ...PROJECT_FRAME, ...FRESH }),
});

/** The draft as it stands, for the screens that frame it before it reaches the board. */
export function useDraftFrame(): Pick<DraftState, "project" | "savedId"> {
  const { project, savedId } = useDraftStore();
  return { project, savedId };
}

/**
 * "+": opens a new, unsaved board in the project; `pin` pins it once stored, `addWidget` opens
 * the picker. A product sidebar's dialog passes the `name`, `scope` and `homeProduct` it picked.
 */
export function useStartDraft() {
  const host = useAnalyticsHost();
  return ({
    projectId,
    projectSlug,
    pin = false,
    addWidget = false,
    name,
    scope = PROJECT_FRAME.scope,
    homeProduct = PROJECT_FRAME.homeProduct,
  }: {
    projectId: string;
    projectSlug: string;
    pin?: boolean;
    addWidget?: boolean;
    name?: string;
    scope?: DashboardScope;
    homeProduct?: DashboardHomeProduct;
  }) => {
    useDraftStore.setState(({ generation }) => ({
      generation: generation + 1,
      projectId,
      ...PROJECT_FRAME,
      ...FRESH,
      pin,
      name,
      scope,
      homeProduct,
    }));
    const path = draftBoardPath({ projectSlug });
    host.navigate(addWidget ? withBlockPickerOpen(path) : path);
  };
}

/** The "New dashboard" dialog: opens a new board in Dashboards with the name, home and scope. */
export function useStartLibraryDraft() {
  const host = useAnalyticsHost();
  return ({
    project,
    name,
    scope,
    homeProduct,
  }: {
    project: DashboardProject;
    name: string;
    scope: DashboardScope;
    homeProduct: DashboardHomeProduct;
  }) => {
    useDraftStore.setState(({ generation }) => ({
      generation: generation + 1,
      projectId: project.id,
      ...FRESH,
      name,
      homeProduct,
      scope,
      atOrganization: true,
      project,
    }));
    host.navigate(organizationBoardPath({ dashboardId: DRAFT_SEGMENT }));
  };
}

/** `/dashboards/new` opened afresh: the draft is held in the member's store project. */
export function holdDraftInDashboards(project: DashboardProject): void {
  useDraftStore.setState({ projectId: project.id, project, atOrganization: true });
}

/** A fresh draft in place of the one held, keeping the generation moving and where it opened. */
function restartDraft(projectId: string): DraftState {
  const at = useDraftStore.getState();
  const place = at.project?.id === projectId ? { atOrganization: true, project: at.project } : {};
  const fresh = { ...PROJECT_FRAME, ...place, generation: at.generation + 1, projectId, ...FRESH };
  useDraftStore.setState(fresh);
  return fresh;
}

/** Arriving at the draft's address after it was stored opens a new draft, never that board. */
export function restartStoredDraft(projectId: string): void {
  if (useDraftStore.getState().savedId !== void 0) restartDraft(projectId);
}

/**
 * The draft's address opened: a stored draft, or one held for another project (or none, on a
 * fresh load), starts over now, so the first edit never re-keys the screen under its editor.
 */
export function openDraftAddress(projectId: string): void {
  const { savedId, projectId: heldFor } = useDraftStore.getState();
  if (savedId !== void 0 || heldFor !== projectId) restartDraft(projectId);
}

/** Settles once the draft writes on this stored board, queued before now, have landed. */
export function afterDraftWrites(dashboardId: string): Promise<void> {
  const { savedId, saving } = useDraftStore.getState();
  if (savedId !== dashboardId || !saving) return Promise.resolve();
  return saving.then(
    () => void 0,
    () => void 0,
  );
}

/** The draft this project has open; one from another project starts over. */
function currentDraft(projectId: string): DraftState {
  const draft = useDraftStore.getState();
  return draft.projectId === projectId ? draft : restartDraft(projectId);
}

/** What storing a draft and writing edits onto it reach for. */
type DraftWriter = {
  projectId: string;
  projectSlug: string;
  /** The names of the boards beside it, so an unnamed draft is numbered past them. */
  takenNames: readonly string[];
  host: AnalyticsHostApi;
  analytics: UiAnalytics;
  utils: ReturnType<typeof analyticsApi.useUtils>;
};

function refreshLists({ utils, projectId, host }: DraftWriter) {
  return Promise.all([
    utils.boards.getAll.invalidate({ projectId }),
    utils.boards.listStarred.invalidate({ projectId }),
    utils.boards.listInOrganization.invalidate({ organizationId: host.organizationId() ?? "" }),
  ]);
}

/** Where the stored board opens: in Dashboards when the draft was opened there. */
function storedBoardPath({
  writer,
  at,
  dashboardId,
}: {
  writer: DraftWriter;
  at: DraftState;
  dashboardId: string;
}) {
  return at.atOrganization
    ? organizationBoardPath({ dashboardId })
    : dashboardsPath({ projectSlug: writer.projectSlug, dashboardId });
}

/** Writes what an edit carries onto a stored board; a refused pin still keeps the board. */
async function applyEdit({
  writer,
  dashboardId,
  edit: { name, description, pin },
}: {
  writer: DraftWriter;
  dashboardId: string;
  edit: DraftEdit;
}): Promise<void> {
  const { utils, projectId, host } = writer;
  if (name !== void 0 || description !== void 0) {
    await utils.client.boards.update.mutate({
      projectId,
      dashboardId,
      ...(name === void 0 ? {} : { name }),
      ...(description === void 0 ? {} : { description }),
    });
  }
  if (!pin) return;
  await utils.client.boards.star
    .mutate({ projectId, star: { kind: "board", dashboardId } })
    .catch((error: unknown) => host.failed({ error, fallbackTitle: "Couldn't pin the dashboard" }));
}

/** Whether the draft `at` was taken from is still the one held, not one a later "+" opened. */
const isHeld = (at: DraftState) => useDraftStore.getState().generation === at.generation;

/**
 * Makes the board with the edit, then writes the rest onto it. The board is the draft's from the
 * moment it exists: a refused description is reported, never a reason to store a second board.
 * A store a later "+" overtook leaves that newer draft and its address alone.
 */
async function storeDraft({
  writer,
  edit,
  at,
}: {
  writer: DraftWriter;
  edit: DraftEdit;
  at: DraftState;
}): Promise<string> {
  const { utils, projectId, host, analytics, takenNames } = writer;
  const name = edit.name ?? at.name ?? untitledBoardName({ takenNames });
  const made = { projectId, name, homeProduct: at.homeProduct };
  // Another scope also asks analytics:update, so a seat refused it is refused before a write.
  const created =
    at.scope === "PROJECT"
      ? await utils.client.boards.create.mutate(made)
      : await utils.client.boards.createAtScope.mutate({ ...made, scope: at.scope });
  analytics.track(
    edit.templateId === void 0
      ? dashboardCreated({ createdFrom: "blank" })
      : dashboardCreated({ createdFrom: "template", templateId: edit.templateId }),
  );
  if (isHeld(at)) useDraftStore.setState({ savedId: created.id });
  // A cleared description stays cleared; a pin taken off while this ran is not written.
  const description = edit.description === void 0 ? at.description : edit.description;
  const pin = (at.pin || edit.pin === true) && (!isHeld(at) || useDraftStore.getState().pin);
  await applyEdit({
    writer,
    dashboardId: created.id,
    edit: { description: description ?? void 0, pin },
  }).catch((error: unknown) =>
    host.failed({ error, fallbackTitle: "Couldn't save the description" }),
  );
  await refreshLists(writer);
  // Only while this draft is still on screen: a member who moved on stays where they went.
  const route = host.route();
  if (isHeld(at) && route.params.dashboardId === DRAFT_SEGMENT) {
    const path = storedBoardPath({ writer, at, dashboardId: created.id });
    // "Add a widget" made or asked the first edit and is closing; its key must not reopen it.
    const query = { ...route.query, [WIDGET_PICKER_QUERY_KEY]: void 0 };
    host.navigate(withQueryString({ path, query }), { replace: true });
  }
  return created.id;
}

/**
 * Stores the draft with this edit, or, while it is being stored, writes the edit onto it once
 * it is and after every edit queued before it, so the last one submitted is the one kept.
 * Resolves the stored board's id; a refused store rejects and keeps the draft.
 */
function materialiseDraft({ writer, edit }: { writer: DraftWriter; edit: DraftEdit }) {
  const at = currentDraft(writer.projectId);
  // Shown at once, while the store runs.
  useDraftStore.setState({
    ...(edit.name === void 0 ? {} : { name: edit.name }),
    ...(edit.description === void 0 ? {} : { description: edit.description }),
    ...(edit.pin ? { pin: true } : {}),
  });
  const { saving } = at;
  if (saving) {
    const queued = saving.then(async (dashboardId) => {
      // A pin taken off while the store ran is not written.
      const pin = edit.pin === true && (!isHeld(at) || useDraftStore.getState().pin);
      await applyEdit({ writer, dashboardId, edit: { ...edit, pin } });
      await refreshLists(writer);
      return dashboardId;
    });
    // The next edit waits on this one, and still gets the board when this one is refused.
    const next = queued.catch(() => saving);
    next.catch(() => void 0);
    if (isHeld(at)) useDraftStore.setState({ saving: next });
    return queued;
  }
  const storing = storeDraft({ writer, edit, at });
  useDraftStore.setState({ saving: storing, refused: false });
  // The caller reports the refusal; the draft stays to be stored by the next edit. A newer
  // draft's own store is never dropped by this one failing.
  storing.catch(() => {
    if (!isHeld(at)) return;
    const { savedId } = useDraftStore.getState();
    // A board made before the failure stays the one every later edit writes onto.
    useDraftStore.setState(
      savedId === void 0 ? { saving: void 0, refused: true } : { saving: Promise.resolve(savedId) },
    );
  });
  return storing;
}

export function useDraftBoard({ takenNames }: { takenNames: readonly string[] }) {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const project = host.project();
  const projectId = project?.id ?? "";
  const writer: DraftWriter = {
    projectId,
    projectSlug: project?.slug ?? "",
    takenNames,
    host,
    analytics,
    utils,
  };
  const draft = useDraftStore();
  const held = draft.projectId === projectId ? draft : { ...draft, ...PROJECT_FRAME, ...FRESH };

  const board: SavedBoard = {
    id: DRAFT_SEGMENT,
    projectId,
    name: held.name ?? untitledBoardName({ takenNames }),
    description: held.description,
    createdById: host.userId() ?? null,
    scope: held.scope,
    homeProduct: held.homeProduct,
    organizationId: null,
    ownerProject: null,
    isStarred: held.pin,
    updatedAt: "",
  };

  return {
    /** The draft as a board, which no list holds. */
    board,
    /**
     * Keys the board screen: the same before and after the draft is stored, and before and
     * after a draft not held yet starts over, which moves the generation on by one.
     */
    key: `draft-${draft.generation + (held === draft ? 0 : 1)}`,
    /** The board this draft became, while the screen still shows it as the draft's. */
    savedId: held.savedId,
    materialise: (edit: DraftEdit = {}): Promise<string> => materialiseDraft({ writer, edit }),
    /** Whether the last store was refused, so an unchanged edit is still worth sending. */
    refused: held.refused,
    /** Whether its first edit is being stored right now, when it can no longer be thrown away. */
    isStoring: held.saving !== void 0 && held.savedId === void 0,
    /**
     * Throws the draft away before anything is stored, and leaves for where boards open: the
     * project's dashboards, or Dashboards when it was opened there.
     */
    discard: () => {
      const at = useDraftStore.getState();
      if (at.projectId === projectId && at.saving !== void 0) return;
      // A draft held for another project keeps that project's frame: leave by this one's address.
      const fromOrganization = at.projectId === projectId && at.atOrganization;
      restartDraft(projectId);
      host.navigate(
        fromOrganization
          ? ORGANIZATION_DASHBOARDS_PATH
          : dashboardsPath({ projectSlug: writer.projectSlug }),
        { replace: true },
      );
    },
    /** Takes the pin off a draft not stored yet; it stores nothing. */
    unpin: () => {
      if (useDraftStore.getState().projectId === projectId) useDraftStore.setState({ pin: false });
    },
  };
}
