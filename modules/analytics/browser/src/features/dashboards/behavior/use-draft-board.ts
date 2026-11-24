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
  organizationBoardPath,
  untitledBoardName,
  withQueryString,
} from "../model/boards.ts";
import { dashboardCreated } from "../model/dashboard-usage-events.ts";
import { withBlockPickerOpen } from "./use-block-picker-address.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/** What a draft's first edit, or one made while it is being stored, carries. */
export type DraftEdit = { name?: string; description?: string | null; pin?: boolean };

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
  /** The one store in flight; every edit waits on it rather than storing again. */
  saving: Promise<string> | undefined;
};

const FRESH = {
  name: void 0,
  description: null,
  pin: false,
  savedId: void 0,
  saving: void 0,
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

/** "+": opens a new, unsaved board; `pin` pins it once stored, `addWidget` opens the picker. */
export function useStartDraft() {
  const host = useAnalyticsHost();
  return ({
    projectId,
    projectSlug,
    pin = false,
    addWidget = false,
  }: {
    projectId: string;
    projectSlug: string;
    pin?: boolean;
    addWidget?: boolean;
  }) => {
    useDraftStore.setState(({ generation }) => ({
      generation: generation + 1,
      projectId,
      ...PROJECT_FRAME,
      ...FRESH,
      pin,
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

/** The draft this project has open; one from another project starts over. */
function currentDraft(projectId: string): DraftState {
  const draft = useDraftStore.getState();
  return draft.projectId === projectId ? draft : restartDraft(projectId);
}

/** What storing a draft and writing edits onto it reach for. */
type DraftWriter = {
  projectId: string;
  projectSlug: string;
  existingCount: number;
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

/** Makes the board with the edit, then moves the address to it if the draft is still open. */
async function storeDraft({
  writer,
  edit,
  at,
}: {
  writer: DraftWriter;
  edit: DraftEdit;
  at: DraftState;
}): Promise<string> {
  const { utils, projectId, host, analytics, existingCount } = writer;
  const name = edit.name ?? at.name ?? untitledBoardName({ existingCount });
  const made = { projectId, name, homeProduct: at.homeProduct };
  // Another scope also asks analytics:update, so a seat refused it is refused before a write.
  const created =
    at.scope === "PROJECT"
      ? await utils.client.boards.create.mutate(made)
      : await utils.client.boards.createAtScope.mutate({ ...made, scope: at.scope });
  analytics.track(dashboardCreated({ createdFrom: "blank" }));
  await applyEdit({
    writer,
    dashboardId: created.id,
    // A new board has no description, so only one typed before it was stored is written.
    edit: { description: edit.description ?? at.description ?? void 0, pin: at.pin || edit.pin },
  });
  useDraftStore.setState({ savedId: created.id });
  await refreshLists(writer);
  // Only while the draft is still on screen: a member who moved on stays where they went.
  const route = host.route();
  if (route.params.dashboardId === DRAFT_SEGMENT) {
    const path = storedBoardPath({ writer, at, dashboardId: created.id });
    host.navigate(withQueryString({ path, query: route.query }), { replace: true });
  }
  return created.id;
}

/**
 * Stores the draft with this edit, or, while it is being stored, writes the edit onto it once
 * it is. Resolves the stored board's id; a refused store rejects and keeps the draft.
 */
function materialiseDraft({ writer, edit }: { writer: DraftWriter; edit: DraftEdit }) {
  const at = currentDraft(writer.projectId);
  // Shown at once, while the store runs.
  useDraftStore.setState({
    ...(edit.name === void 0 ? {} : { name: edit.name }),
    ...(edit.description === void 0 ? {} : { description: edit.description }),
    ...(edit.pin ? { pin: true } : {}),
  });
  if (at.saving) {
    return at.saving.then(async (dashboardId) => {
      await applyEdit({ writer, dashboardId, edit });
      await refreshLists(writer);
      return dashboardId;
    });
  }
  const saving = storeDraft({ writer, edit, at });
  useDraftStore.setState({ saving });
  // The caller reports the refusal; the draft stays to be stored by the next edit.
  saving.catch(() => useDraftStore.setState({ saving: void 0 }));
  return saving;
}

export function useDraftBoard({ existingCount }: { existingCount: number }) {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const project = host.project();
  const projectId = project?.id ?? "";
  const writer: DraftWriter = {
    projectId,
    projectSlug: project?.slug ?? "",
    existingCount,
    host,
    analytics,
    utils,
  };
  const draft = useDraftStore();
  const held = draft.projectId === projectId ? draft : { ...draft, ...PROJECT_FRAME, ...FRESH };

  const board: SavedBoard = {
    id: DRAFT_SEGMENT,
    projectId,
    name: held.name ?? untitledBoardName({ existingCount }),
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
    /** Keys the board screen: the same before and after the draft is stored. */
    key: `draft-${draft.generation}`,
    /** The board this draft became, while the screen still shows it as the draft's. */
    savedId: held.savedId,
    materialise: (edit: DraftEdit = {}): Promise<string> => materialiseDraft({ writer, edit }),
  };
}
