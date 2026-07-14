import { create } from "zustand";
import type { LimitType } from "../server/license-enforcement/types";

/** Modal opened by license enforcement when a limit is reached. */
type LimitVariant = {
  mode: "limit";
  limitType: LimitType;
  current: number;
  max: number;
};

/** Modal opened to confirm a seat quantity update with proration preview. */
type SeatsVariant = {
  mode: "seats";
  organizationId: string;
  currentSeats: number;
  newSeats: number;
  onConfirm: () => Promise<void>;
};

/** Modal shown when a lite member tries to access a restricted feature. */
type LiteMemberRestrictionVariant = {
  mode: "liteMemberRestriction";
  resource?: string;
};

export type UpgradeModalVariant =
  | LimitVariant
  | SeatsVariant
  | LiteMemberRestrictionVariant;

interface OpenSeatsParams {
  organizationId: string;
  currentSeats: number;
  newSeats: number;
  onConfirm: () => Promise<void>;
}

interface UpgradeModalState {
  isOpen: boolean;
  variant: UpgradeModalVariant | null;

  // Legacy fields kept for backward compatibility with existing callers.
  limitType: LimitType | null;
  current: number | null;
  max: number | null;

  /** Open the modal in limit enforcement mode. Backward-compatible signature. */
  open: (limitType: LimitType, current: number, max: number) => void;

  /** Open the modal in seats confirmation mode. */
  openSeats: (params: OpenSeatsParams) => void;

  /** Open the modal in lite member restriction mode. */
  openLiteMemberRestriction: (params: { resource?: string }) => void;

  /** Close the modal and reset all state. */
  close: () => void;
}

export const useUpgradeModalStore = create<UpgradeModalState>((set) => ({
  isOpen: false,
  variant: null,
  limitType: null,
  current: null,
  max: null,

  open: (limitType, current, max) =>
    set({
      isOpen: true,
      variant: { mode: "limit", limitType, current, max },
      // Populate legacy fields so existing callers (GlobalUpgradeModal, etc.) keep working.
      limitType,
      current,
      max,
    }),

  openSeats: ({ organizationId, currentSeats, newSeats, onConfirm }) =>
    set({
      isOpen: true,
      variant: { mode: "seats", organizationId, currentSeats, newSeats, onConfirm },
      // Clear legacy fields since seats mode does not use them.
      limitType: null,
      current: null,
      max: null,
    }),

  openLiteMemberRestriction: ({ resource }) =>
    set({
      isOpen: true,
      variant: { mode: "liteMemberRestriction", resource },
      // Clear legacy fields since lite member restriction mode does not use them.
      limitType: null,
      current: null,
      max: null,
    }),

  close: () =>
    set({
      isOpen: false,
      variant: null,
      limitType: null,
      current: null,
      max: null,
    }),
}));
