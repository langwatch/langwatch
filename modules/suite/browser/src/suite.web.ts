/**
 * Suite routes nothing in the browser: it only declares the `suite:run-history`
 * slice at install. Scenario's declaration renders the Suite-run pages and dialogs.
 */

import { defineBrowserModule } from "@langwatch/browser";

// Declares the `suite:run-history` slice at install, so scenario reads it from first paint.
import "./behavior/use-run-history-store.ts";

export const suiteWeb = defineBrowserModule("suite");
