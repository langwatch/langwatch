/**
 * Auth's two-step verification ceremonies, lent to the personal workspace's
 * security screen: start a setup, confirm it, and issue fresh backup codes.
 * Travels by declaration (ARCHITECTURE.md §10.1, kit rule 7).
 */

import {
  confirmUiTwoStepSetup,
  regenerateUiBackupCodes,
  startUiTwoStepSetup,
} from "./ui-two-factor.ts";

export const twoStepCapability = {
  start: (input: { password?: string }) => startUiTwoStepSetup(input),
  confirm: (input: { code: string }) => confirmUiTwoStepSetup(input),
  regenerateBackupCodes: (input: { password?: string }) => regenerateUiBackupCodes(input),
};

export default twoStepCapability;
