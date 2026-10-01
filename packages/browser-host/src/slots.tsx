/**
 * A place a core screen leaves for a block it may not name. It asks by name
 * and renders the fallback where nothing filled the slot.
 * Design: dev/docs/best_practices/ui-install.md
 */

import type { ComponentType, ReactNode } from "react";

import { useOptionalUiCapabilities } from "./capabilities.ts";
import type { UpgradeModalSeatsVariant } from "./upgrade-modal-store.ts";

/**
 * What a screen hands the block it asked for — the CORE side of the contract,
 * so a fill adapts its own component to this rather than the other way round.
 */
export type UiSlotProps = {
  /** The "need more?" card. It reads the plan itself and takes nothing. */
  contactSales: Record<never, never>;
  /** Said above a provider's credentials when the credentials are not the customer's. */
  managedModelProviderAlert: { provider: string; error?: string };
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
 * What the composition put in each slot. A host that installed no slots at all
 * behaves exactly like one that filled none: the screen renders its fallback.
 */
export abstract class UiSlots {
  /** The component filling this slot, or undefined where none is. */
  filled<Name extends UiSlotName>(_name: Name): UiSlotComponent<Name> | undefined {
    return void 0;
  }
}

class InstalledUiSlots extends UiSlots {
  constructor(private readonly components: UiSlotComponents) {
    super();
  }

  override filled<Name extends UiSlotName>(name: Name): UiSlotComponent<Name> | undefined {
    return this.components[name];
  }
}

/** What a composition installs: the blocks it can supply, and nothing else. */
export function uiSlots({ components = {} }: { components?: UiSlotComponents } = {}): UiSlots {
  return new InstalledUiSlots(components);
}

/** A composition that filled nothing. Every reading is the core default. */
export const UNFILLED_UI_SLOTS: UiSlots = uiSlots();

/** The slots above this screen, degrading to the unfilled ones outside a shell. */
export function useUiSlots(): UiSlots {
  return useOptionalUiCapabilities()?.slots ?? UNFILLED_UI_SLOTS;
}

/** The component filling one slot, for a screen that needs the element itself. */
function useUiSlot<Name extends UiSlotName>(name: Name): UiSlotComponent<Name> | undefined {
  return useUiSlots().filled(name);
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
