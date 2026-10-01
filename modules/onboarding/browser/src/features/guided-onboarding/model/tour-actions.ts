/**
 * The actions a page lends to the guided tour: registered on mount, taken
 * back on unmount, so a step whose page is gone does nothing. One that
 * fires a request hands back its promise, so the tour can wait for it.
 */
export interface TourActions {
  expandGroup: (id: string) => void;
  collapseGroup: (id: string) => void;
  /** Puts every group the tour folded or opened back how the user had it. */
  restoreGroups: () => void;
  openVirtualKeyCreate: () => void;
  typeVirtualKeyName: (name: string) => void;
  /** Hands back the create request, so the tour knows when it answered. */
  submitVirtualKeyCreate: () => Promise<void>;
  revealVirtualKeySecret: () => void;
  /** Turns the governance sample panels on, for whichever page is in view. */
  showSampleData: () => void;
  /** Turns them off again, so nothing invented outlives the tour. */
  hideSampleData: () => void;
  /** Opens the inventory's Add source menu, the governance tour's last stop. */
  openAddSourceMenu: () => void;
}
