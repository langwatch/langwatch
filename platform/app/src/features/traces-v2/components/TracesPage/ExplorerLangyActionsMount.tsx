import type React from "react";
import { useRegisterLangyActions } from "~/features/langy/LangyContext";
import { useExplorerLangyActions } from "./useExplorerLangyActions";

/**
 * Registers the Explorer's typed UI actions with Langy for as long as the
 * page is open, and clears them when it closes, so a dispatch made while the
 * user is elsewhere goes unclaimed and takes its away form instead.
 */
export const ExplorerLangyActionsMount: React.FC = () => {
  useRegisterLangyActions(useExplorerLangyActions());
  return null;
};
