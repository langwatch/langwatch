/**
 * What other modules may read of the Langy panel's client state. The slices
 * live in the global UI store under `langy:`; Langy writes them, any module reads.
 * The command channel here (`askLangy`, `attachContext`) is replaced by a later change.
 */

import type { z } from "zod";

import type { LangyResourceKind } from "./langy-turn-context.ts";

export const LANGY_STORE_SLICE = "langy:store";
export const LANGY_CONTEXT_TARGET_SLICE = "langy:context-target";
export const LANGY_PAGE_CONTEXT_SLICE = "langy:page-context";
export const LANGY_REGISTRATIONS_SLICE = "langy:registrations";

/**
 * A removable page-context chip that rides INSIDE the composer surface (e.g.
 * "Experiment: my-slug", "Trace: abc123", "Project: web-app").
 */
export interface LangyContextChip {
  /** Stable id, e.g. `experiment:my-slug`. Selection is keyed on this. */
  id: string;
  kind: LangyResourceKind;
  label: string;
  /**
   * The resource ref (id / slug) this chip stands for, forwarded to the agent
   * as turn context. Absent for the project chip (the project is implicit).
   */
  ref?: string;
}

/**
 * A piece of context a SURFACE explicitly hands to Langy — the home briefing's "look at
 * this receipt", a card's "work from this", anything off the current route.
 */
export type LangyAttachedContextType = LangyContextChip["kind"];

export interface LangyAttachedContext {
  type: LangyAttachedContextType;
  /** Resource ref/id — forwarded to the agent as the chip's `ref`. */
  id: string;
  /** Human-friendly name shown in the sidebar. */
  label: string;
  /** Optional display/agent extras, e.g. `{ value: "8.2s", severity: "error" }`. */
  meta?: Record<string, unknown>;
}

/**
 * How the panel is laid out (Notion-style). `floating` = a rounded card that overlays
 * the page (and floats above a drawer); `sidebar` = a full-height right dock that
 * pushes page content left (a drawer nests to its left). User-picked, persisted.
 */
export type LangyPanelMode = "floating" | "sidebar";

/**
 * A registrable page target. Structurally a `LangyContextChip` — a clicked
 * target IS the chip it becomes, so nothing has to be mapped at the boundary.
 */
export type LangyContextTargetDescriptor = LangyContextChip;

/**
 * The drag payload's type, so the panel can tell a dragged context target from the
 * text, files and links the browser will happily hand it otherwise.
 */
export const LANGY_CONTEXT_DRAG_MIME = "application/x-langy-context";

/**
 * The kinds the composer's `#` palette can ask to see on the page ("show me the traces
 * here") or be taken to ("browse datasets").
 */
export type LangyRevealableKind = Extract<
  LangyContextTargetDescriptor["kind"],
  | "trace"
  | "dataset"
  | "prompt"
  | "evaluation"
  | "scenario"
  | "experiment"
  | "workflow"
  | "agent"
  | "automation"
  | "annotation"
  | "dashboard"
>;

/**
 * What put the page into pick-a-thing mode. `null` is disarmed.
 */
export type LangyArmSource = "key";

export interface LangyContextTargetState {
  /** Targets mounted on the page right now, keyed by their stable chip id. */
  targets: Record<string, LangyContextTargetDescriptor>;
  /** Targets the user clicked, in click order. Survives the target unmounting. */
  picked: LangyContextTargetDescriptor[];
  /** Chip ids the composer is currently showing (auto-derived + picked). */
  activeChipIds: Set<string>;

  /**
   * Targets lit BY REQUEST rather than by pointer proximity — the composer's
   * `#trace` → "Show traces on this page" gesture. Rendered exactly like
   * `near`, briefly, then cleared by the shared timer.
   */
  revealedIds: Set<string>;
  /**
   * A reveal that found nothing to light up yet — asked for on one page,
   * answered on the next. `register` consumes it as matching targets mount.
   */
  pendingReveal: { kind: LangyRevealableKind; requestedAt: number } | null;

  /**
   * Proximity, written by `LangyContextTargetLayer` as the pointer moves.
   */
  nearIds: Set<string>;
  hoveredId: string | null;

  /**
   * The chip the user is pointing at INSIDE the panel — the other direction.
   */
  spotlightId: string | null;
  setSpotlight: (id: string | null) => void;

  /**
   * The thing that was just taken into context, and a nonce so taking the SAME
   * thing twice replays rather than sits there already-equal and paints
   * nothing. Cleared by the flourish itself once it has finished.
   */
  absorbFlash: { id: string; nonce: number } | null;
  flashAbsorb: (id: string) => void;
  clearAbsorbFlash: (nonce: number) => void;

  /**
   * Pick-a-thing mode.
   */
  armSource: LangyArmSource | null;
  arm: (source: LangyArmSource) => void;
  /** Release. `source` scopes it: a Shift keyup must not cancel a `#` latch. */
  disarm: (source?: LangyArmSource) => void;
  toggleArm: () => void;

  register: (target: LangyContextTargetDescriptor) => void;
  unregister: (id: string) => void;

  pick: (target: LangyContextTargetDescriptor) => void;
  unpick: (id: string) => void;
  clearPicked: () => void;

  /**
   * Light up every mounted target of `kind` for a moment — or, when none is
   * mounted (asked from a page without them), remember the ask so the targets
   * light up as they arrive on the next page.
   */
  requestReveal: (request: { kind: LangyRevealableKind }) => void;
  /**
   * Keep a reveal alive while the pointer is on one of its targets.
   */
  holdReveal: () => void;
  clearReveal: () => void;

  /** Published by `useLangyPageContext` on every chip-list change. */
  setActiveChipIds: (ids: string[]) => void;
  setProximity: (proximity: { nearIds: string[]; hoveredId: string | null }) => void;

  reset: () => void;
}

/** The part of the panel's state another module reads or commands. */
export interface LangySliceSurface {
  isOpen: boolean;
  openPanel: () => void;
  pendingPrompt: string | null;
  /** Open Langy on a fresh conversation and queue `prompt` to auto-send. */
  askLangy: (prompt: string) => void;
  panelMode: LangyPanelMode;
  /** The home page's ask field is in use right now. */
  setHomeAskOpen: (open: boolean) => void;
  /** What the page Langy is driving is doing this second, in the page's words, or null. */
  pageActivity: string | null;
  setPageActivity: (activity: string | null) => void;
  activeConversationId: string | null;
  /** Page-context chips the user has CHOSEN, by id. */
  chosenChipIds: Set<string>;
  /** Take a candidate chip into context. */
  chooseChip: (id: string) => void;
  /** Drop a chosen chip, the chip's own x. */
  dismissChip: (id: string) => void;
  attachedContext: LangyAttachedContext[];
  attachContext: (item: LangyAttachedContext) => void;
  detachContext: (id: string) => void;
}

/**
 * The precise context the current page declares for Langy (a dataset with its name), which the
 * route alone cannot express. The panel reads it; any module's page writes it.
 */
export interface LangyPageContextState {
  pageContext: LangyContextChip[];
  register: (items: LangyContextChip[]) => void;
  clear: () => void;
}

const nothing = (): void => {};

/** What a reader sees where Langy is not installed: closed, and every command a no-op. */
export const LANGY_ABSENT_SURFACE: LangySliceSurface = {
  isOpen: false,
  openPanel: nothing,
  pendingPrompt: null,
  askLangy: nothing,
  panelMode: "sidebar",
  setHomeAskOpen: nothing,
  pageActivity: null,
  setPageActivity: nothing,
  activeConversationId: null,
  chosenChipIds: new Set<string>(),
  chooseChip: nothing,
  dismissChip: nothing,
  attachedContext: [],
  attachContext: nothing,
  detachContext: nothing,
};

/** What a reader sees where Langy is not installed: nothing on the page is a target. */
export const LANGY_ABSENT_CONTEXT_TARGET: LangyContextTargetState = {
  targets: {},
  picked: [],
  activeChipIds: new Set<string>(),
  revealedIds: new Set<string>(),
  pendingReveal: null,
  nearIds: new Set<string>(),
  hoveredId: null,
  spotlightId: null,
  setSpotlight: nothing,
  absorbFlash: null,
  flashAbsorb: nothing,
  clearAbsorbFlash: nothing,
  armSource: null,
  arm: nothing,
  disarm: nothing,
  toggleArm: nothing,
  register: nothing,
  unregister: nothing,
  pick: nothing,
  unpick: nothing,
  clearPicked: nothing,
  requestReveal: nothing,
  holdReveal: nothing,
  clearReveal: nothing,
  setActiveChipIds: nothing,
  setProximity: nothing,
  reset: nothing,
};

/** What a reader sees where Langy is not installed: no page context, registering is a no-op. */
export const LANGY_ABSENT_PAGE_CONTEXT: LangyPageContextState = {
  pageContext: [],
  register: nothing,
  clear: nothing,
};

/** What the page offers the reader once a proposal has been applied. */
export type AppliedOutcome =
  | {
      label?: string;
      onOpen?: () => void;
      href?: string;
    }
  | undefined;

/** The proposals this page can apply, by proposal kind. */
export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<AppliedOutcome>
>;

/** One page-registered UI action the agent may drive (specs/langy/langy-ui-actions.feature). */
export interface LangyUiActionHandler {
  payloadSchema: z.ZodTypeAny;
  run: (payload: never) => unknown;
}

/** Everything the current page can execute, keyed by action kind. */
export type LangyUiActionHandlers = Record<string, LangyUiActionHandler>;

/** How a page hands Langy what it can apply and run; Langy's provider publishes these. */
export interface LangyRegistrationsState {
  registerHandlers: (handlers: ProposalHandlers, opts?: { experimentSlug?: string }) => void;
  clearHandlers: () => void;
  registerActions: (handlers: LangyUiActionHandlers) => void;
  clearActions: () => void;
}

/** What a page sees where Langy is not mounted: registering is a no-op. */
export const LANGY_ABSENT_REGISTRATIONS: LangyRegistrationsState = {
  registerHandlers: nothing,
  clearHandlers: nothing,
  registerActions: nothing,
  clearActions: nothing,
};
