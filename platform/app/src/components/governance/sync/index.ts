/**
 * The governance section's shared "ask the providers again" control.
 *
 * Import from here rather than the file, so the module path stays stable if
 * the component grows siblings:
 *
 *   import { GovernanceSyncButton } from "~/components/governance/sync";
 */
export {
  GovernanceSyncButton,
  type GovernanceSyncState,
} from "./GovernanceSyncButton";
export {
  type GovernanceSyncStatus,
  type GovernanceSyncUnavailable,
  governanceSyncStatus,
} from "./syncControlState";
