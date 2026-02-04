import { create } from "zustand";
import type { LimitType } from "../server/license-enforcement/types";

interface UpgradeModalState {
  isOpen: boolean;
  limitType: LimitType | null;
  current: number | null;
  max: number | null;
  open: (limitType: LimitType, current: number, max: number) => void;
  close: () => void;
}

export const useUpgradeModalStore = create<UpgradeModalState>((set) => ({
  isOpen: false,
  limitType: null,
  current: null,
  max: null,
  open: (limitType, current, max) =>
    set({
      isOpen: true,
      limitType,
      current,
      max,
    }),
  close: () =>
    set({
      isOpen: false,
      limitType: null,
      current: null,
      max: null,
    }),
}));
