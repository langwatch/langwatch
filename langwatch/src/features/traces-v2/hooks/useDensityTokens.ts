import { useUIStore } from "../stores/uiStore";

/**
 * All density-dependent sizing in one place.
 *
 * Components should NOT branch on `density` themselves — they read the tokens
 * here. Adding a new dimension means adding it to both COMPACT and COMFORTABLE
 * below, then using it from the hook.
 */
export interface DensityTokens {
  /** Main trace row vertical padding (per cell) */
  rowPaddingY: string;
  /** Trace cell text size */
  rowFontSize: string;
  /** I/O preview line font size */
  ioFontSize: string;
  /** I/O sub-row top padding */
  ioPaddingTop: string;
  /** I/O sub-row bottom padding */
  ioPaddingBottom: string;
  /** Conversation/group row vertical padding */
  groupRowPaddingY: string;
  /** Errors lens row vertical padding */
  errorRowPaddingY: string;
  /** Errors lens cell text size */
  errorRowFontSize: string;
  /** Errors lens detail-line bottom padding */
  errorDetailPaddingBottom: string;
}

const COMPACT: DensityTokens = {
  rowPaddingY: "4px",
  rowFontSize: "12px",
  ioFontSize: "11px",
  ioPaddingTop: "2px",
  ioPaddingBottom: "5px",
  groupRowPaddingY: "7px",
  errorRowPaddingY: "5px",
  errorRowFontSize: "12px",
  errorDetailPaddingBottom: "5px",
};

const COMFORTABLE: DensityTokens = {
  rowPaddingY: "12px",
  rowFontSize: "14px",
  ioFontSize: "13px",
  ioPaddingTop: "2px",
  ioPaddingBottom: "10px",
  groupRowPaddingY: "12px",
  errorRowPaddingY: "12px",
  errorRowFontSize: "14px",
  errorDetailPaddingBottom: "10px",
};

export function useDensityTokens(): DensityTokens {
  const density = useUIStore((s) => s.density);
  return density === "compact" ? COMPACT : COMFORTABLE;
}
