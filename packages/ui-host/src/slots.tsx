/**
 * A place a core screen leaves for a block it may not name. It asks by name
 * and renders the fallback where nothing filled the slot.
 * Design: dev/docs/best_practices/ui-install.md
 */

import type { ComponentType, ReactNode } from "react";
import { useOptionalUiCapabilities } from "./capabilities";
import type { UpgradeModalSeatsVariant } from "./upgrade-modal-store";

/**
 * What a screen hands the block it asked for — the CORE side of the contract,
 * so a fill adapts its own component to this rather than the other way round.
 */
export type UiSlotProps = {
  /** The "need more?" card. It reads the plan itself and takes nothing. */
  contactSales: Record<never, never>;
  /** One line of "how much of this you may have, and how much you use". */
  resourceLimits: { label: string; current: number; max?: number };
  /**
   * The remembered answer to "how should Langy reach my code", on the Integrations screen. Empty
   * until a choice was stored, so a screen that fills nothing renders nothing.
   */
  langyCodeAccessPreference: Record<never, never>;
  /** Said above a provider's credentials when the credentials are not the customer's. */
  managedModelProviderAlert: { provider: string; error?: string };
  /** The store-driven upgrade/limit dialog, mounted once at the app root. */
  globalUpgradeModal: Record<never, never>;
  /**
   * The body of the seat-update dialog: what the change costs, and the button
   * that confirms it. Priced by whoever bills, which is why the dialog asks for
   * it rather than pricing the change itself.
   */
  seatProrationPreview: {
    variant: UpgradeModalSeatsVariant;
    open: boolean;
    onClose: () => void;
  };
};

/** The blocks a screen may ask for. */
export type UiSlotName = keyof UiSlotProps;

/** What fills one, once a composition has decided. */
export type UiSlotComponent<Name extends UiSlotName> = ComponentType<UiSlotProps[Name]>;

/** Every slot a composition chose to fill. */
export type UiSlotComponents = {
  [Name in UiSlotName]?: UiSlotComponent<Name>;
};

/**
 * What an admin is told when choosing between a full and a lite seat. Copy,
 * not a component: the words follow from what the person can DO, so a
 * composition with no plan behind it still has a true answer to give.
 */
export type UiSeatTypeCopy = {
  liteMemberShortDescription: string;
  liteMemberExplanation: string;
  liteMemberNeedsTeamWarning: string;
  seatTypesDocPath: string;
};

/** The seat-type words a composition that filled nothing still reads. */
export const CORE_SEAT_TYPE_COPY: UiSeatTypeCopy = {
  liteMemberShortDescription: "Can view the work, but not change it",
  liteMemberExplanation:
    "A lite member can open the projects they are invited to and read what the " +
    "team produces there: traces, analytics, evaluations, scenario runs, " +
    "datasets, prompts and experiments. They can leave annotations, and that is " +
    "the only thing they can change. They cannot see costs, and they cannot " +
    "create, edit or delete anything else. The same limits apply wherever they " +
    "reach the data, including the API and the MCP server. Give someone " +
    "permission to change something and they hold a full seat instead.",
  liteMemberNeedsTeamWarning:
    "Add a team, or this person will not see anything. A lite member reaches " +
    "only the projects their teams give them, so one with no team can sign in " +
    "and do no more. You can add a team later from the members list.",
  seatTypesDocPath: "/ai-governance/roles-and-permissions#seats",
};

/**
 * What the composition put in each slot. Both readings are defaulted, so a
 * host that installed no slots at all behaves exactly like one that filled
 * none of them: the screen renders its fallback and nothing throws.
 */
export abstract class UiSlotsPort {
  /** The component filling this slot, or undefined where none is. */
  filled<Name extends UiSlotName>(_name: Name): UiSlotComponent<Name> | undefined {
    return void 0;
  }

  /** The seat-type words this composition wants read. */
  seatTypeCopy(): UiSeatTypeCopy {
    return CORE_SEAT_TYPE_COPY;
  }
}

class InstalledUiSlots extends UiSlotsPort {
  constructor(
    private readonly components: UiSlotComponents,
    private readonly copy: UiSeatTypeCopy,
  ) {
    super();
  }

  override filled<Name extends UiSlotName>(name: Name): UiSlotComponent<Name> | undefined {
    return this.components[name];
  }

  override seatTypeCopy(): UiSeatTypeCopy {
    return this.copy;
  }
}

/** What a composition installs: the blocks it can supply, and nothing else. */
export function uiSlots({
  components = {},
  seatTypeCopy = CORE_SEAT_TYPE_COPY,
}: {
  components?: UiSlotComponents;
  seatTypeCopy?: UiSeatTypeCopy;
} = {}): UiSlotsPort {
  return new InstalledUiSlots(components, seatTypeCopy);
}

/** A composition that filled nothing. Every reading is the core default. */
export const UNFILLED_UI_SLOTS: UiSlotsPort = uiSlots();

/** The slots above this screen, degrading to the unfilled ones outside a shell. */
export function useUiSlots(): UiSlotsPort {
  return useOptionalUiCapabilities()?.slots ?? UNFILLED_UI_SLOTS;
}

/** The component filling one slot, for a screen that needs the element itself. */
export function useUiSlot<Name extends UiSlotName>(name: Name): UiSlotComponent<Name> | undefined {
  return useUiSlots().filled(name);
}

/** The seat-type words, this composition's or core's own. */
export function useUiSeatTypeCopy(): UiSeatTypeCopy {
  return useUiSlots().seatTypeCopy();
}

/**
 * Renders whatever filled `name` with `props`, or `fallback` where nothing
 * did. The props travel in a field of their own because a rest-spread cannot
 * be typed for an unresolved slot name without a cast.
 */
export function UiSlot<Name extends UiSlotName>({
  name,
  props,
  fallback = null,
}: {
  name: Name;
  props: UiSlotProps[Name];
  fallback?: ReactNode;
}): ReactNode {
  const Filled = useUiSlot(name);
  if (!Filled) return fallback;
  return <Filled {...props} />;
}
