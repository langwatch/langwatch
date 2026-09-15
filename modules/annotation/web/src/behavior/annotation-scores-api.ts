/**
 * Typed score-settings procedures share the annotation query cache. Derived
 * from the contract the server binds its handlers to, so the editor and the
 * settings table read the same schemas the procedures declare.
 */

import type { annotationScoreTrpc } from "@langwatch/annotation-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

/** The score-settings transport. Same cache as `annotationApi`, own Provider. */
export const annotationScoresApi = createModuleApi<ContractApiMap<typeof annotationScoreTrpc>>();
