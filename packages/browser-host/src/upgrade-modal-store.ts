import type { LimitType } from "@langwatch/enterprise-licensing-contract";

import { defineSlice } from "./global-store.ts";

/** Modal opened by license enforcement when a limit is reached. */
type LimitVariant = {
  mode: "limit";
  limitType: LimitType;
  current: number;
  max: number;
};

/** Modal opened to confirm a seat quantity update with proration preview. */
export type UpgradeModalSeatsVariant = {
  mode: "seats";
  organizationId: string;
  currentSeats: number;
  newSeats: number;
  /**
   * @param quotedAt the instant the quote on screen was priced, so the charge
   *   can reproduce it rather than re-price at confirm time. Undefined when no
   *   quote was loaded, which leaves the confirm priced at the moment it runs.
   */
  onConfirm: (quotedAt?: number) => Promise<void>;
};

/** Modal shown when a lite member tries to access a restricted feature. */
type LiteMemberRestrictionVariant = {
  mode: "liteMemberRestriction";
  resource?: string;
};

export type UpgradeModalVariant =
  | LimitVariant
  | UpgradeModalSeatsVariant
  | LiteMemberRestrictionVariant;

interface OpenSeatsParams {
  organizationId: string;
  currentSeats: number;
  newSeats: number;
  /**
   * @param quotedAt the instant the quote on screen was priced, so the charge
   *   can reproduce it rather than re-price at confirm time. Undefined when no
   *   quote was loaded, which leaves the confirm priced at the moment it runs.
   */
  onConfirm: (quotedAt?: number) => Promise<void>;
}

interface UpgradeModalState {
  isOpen: boolean;
  variant: UpgradeModalVariant | null;

  /** Open the modal in limit enforcement mode. */
  open: (limitType: LimitType, current: number, max: number) => void;

  /** Open the modal in seats confirmation mode. */
  openSeats: (params: OpenSeatsParams) => void;

  /** Open the modal in lite member restriction mode. */
  openLiteMemberRestriction: (params: { resource?: string }) => void;

  /** Close the modal and reset all state. */
  close: () => void;
}

/** The upgrade modal, held in the global UI store under `shell:`. */
export const useUpgradeModalStore = defineSlice<UpgradeModalState>({
  name: "shell:upgrade-modal",
  create: (set) => ({
    isOpen: false,
    variant: null,
    open: (limitType, current, max) =>
      set({
        isOpen: true,
        variant: { mode: "limit", limitType, current, max },
      }),

    openSeats: ({ organizationId, currentSeats, newSeats, onConfirm }) =>
      set({
        isOpen: true,
        variant: {
          mode: "seats",
          organizationId,
          currentSeats,
          newSeats,
          onConfirm,
        },
      }),

    openLiteMemberRestriction: ({ resource }) =>
      set({
        isOpen: true,
        variant: { mode: "liteMemberRestriction", resource },
      }),

    close: () =>
      set({
        isOpen: false,
        variant: null,
      }),
  }),
});
