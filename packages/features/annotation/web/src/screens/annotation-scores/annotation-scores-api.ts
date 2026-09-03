/**
 * The score-definition procedures, and the hooks that call them.
 *
 * A SECOND MAP IN THE SAME PACKAGE, and that is deliberate rather than an
 * oversight. `behavior/annotation-api.ts` is the annotations LIST's transport
 * and belongs to the family that moved those four keys; the settings page moved
 * separately and needs four procedures that map does not declare, so it brings
 * its own rather than editing a neighbour's file mid-flight.
 *
 * IT COSTS NOTHING TO SPLIT THEM. `createFeatureApi` derives its React Query
 * key from the procedure PATH, so `annotationScore.getAll` asked through this
 * map and through `annotationApi` is the same cache entry — which is what makes
 * the list's counts refresh when this page toggles a score off. What a second
 * map costs is a second Provider, and the application already mounts one per
 * binding.
 *
 * THE SEGMENT NAME IS LOAD-BEARING for exactly that reason: `annotationScore`
 * is the mount point on the root router, and spelling it differently would
 * split the cache instead of sharing it.
 *
 * THIS MODULE IS A GOVERNED-CLOSURE EXCEPTION. ADR-004 seals a screen's closure
 * off from `@langwatch/platform-api-client`; this is the second such import in
 * the package, for the second transport.
 */

import type { AnnotationScore } from "@langwatch/annotation-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** The project every score procedure is scoped to. */
type ProjectScope = { projectId: string };

/** What the editor sends when it saves a definition. */
export type AnnotationScoreUpsertInput = ProjectScope & {
  annotationScoreId?: string | undefined;
  name: string;
  dataType: string;
  description?: string | null;
  category?: string[] | null;
  categoryExplanation?: string[] | null;
  options?: string[] | null;
  radioCheckboxOptions: string[];
  defaultRadioOption: string;
  defaultCheckboxOption: string[];
};

export type AnnotationScoresApiMap = {
  annotationScore: {
    /** Every score definition the project has, active or not. */
    getAll: { query: { input: ProjectScope; output: AnnotationScore[] } };

    /** Only the definitions a reviewer can still pick. Invalidated on save. */
    getAllActive: { query: { input: ProjectScope; output: AnnotationScore[] } };

    /** One definition, for the editor's initial values. */
    getById: {
      query: { input: ProjectScope & { scoreId: string }; output: AnnotationScore | null };
    };

    /**
     * Turns a definition on or off for reviewers.
     *
     * Deactivating is not deleting: the scores already recorded against it stay
     * readable, which is why the table has both a switch and a delete.
     */
    toggle: {
      mutation: {
        input: ProjectScope & { scoreId: string; active: boolean };
        output: unknown;
      };
    };

    delete: {
      mutation: { input: ProjectScope & { scoreId: string }; output: unknown };
    };

    upsert: {
      mutation: { input: AnnotationScoreUpsertInput; output: { name: string } };
    };
  };
};

/** The score-settings transport. Same cache as `annotationApi`, own Provider. */
export const annotationScoresApi = createFeatureApi<AnnotationScoresApiMap>();
