/**
 * Context initialization module.
 *
 * This module registers the context provider for the logger.
 * Import this module early in your application to ensure context
 * is available for logging.
 *
 * Usage:
 * ```typescript
 * import "~/server/context/init";
 * ```
 *
 * Or import it in your logger module (already done in ~/utils/logger.ts).
 */

import { registerContextProvider } from "./contextProvider";
import { getLogContext } from "./logging";

// Register the context provider for the logger
registerContextProvider(getLogContext);
