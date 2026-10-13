/**
 * Installs Temporal on a runtime that does not ship it yet. Imported for its
 * side effect, once, at each process and browser entrypoint; a runtime with a
 * native Temporal keeps its own.
 */

import { Temporal } from "temporal-polyfill";

const scope = globalThis as { Temporal?: typeof Temporal };

scope.Temporal ??= Temporal;
