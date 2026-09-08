/**
 * The procedures this package calls. The annotation namespaces are derived from
 * the contract; the borrowed three belong to features that have not split yet.
 */

import type { annotationScoreTrpc, annotationTrpc } from "@langwatch/annotation-contract";
import { createFeatureApi } from "@langwatch/platform-api-client/feature-api";
import type { ContractApiMap, OutputsFromMap } from "@langwatch/platform-api-client/feature-api";
import type { Trace } from "@langwatch/trace-contract";
import type { AnnotationTrace } from "../model/annotation-row.ts";

/** The project every borrowed procedure is scoped to. */
type ProjectScope = { projectId: string };

/** A member of the organization, as the participants picker lists them. */
export type AnnotationOrganizationMember = {
  user: { id: string; name: string | null; image: string | null };
};

/**
 * Procedures other features own. Each belongs in that feature's own contract;
 * until it is split, this family states the shape it reads.
 */
type BorrowedProcedures = {
  traces: {
    /** One trace, whole: the walker's fallback when a thread answers with no turns. */
    getById: {
      query: {
        input: ProjectScope & { traceId: string };
        output: Trace;
      };
    };

    /**
     * The traces behind a set of annotations, for the input/output columns.
     * `AnnotationTrace` narrows the trace to the three fields a row renders,
     * rather than `@langwatch/trace-contract`'s whole `Trace` span tree.
     */
    getTracesWithSpans: {
      query: {
        input: ProjectScope & { traceIds: string[] };
        output: AnnotationTrace[];
      };
    };
  };

  organization: {
    /** The organization graph, narrowed to what this family reads; shares the shell's cache. */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            id: string;
            name: string;
            isPersonal?: boolean;
            ownerUserId?: string | null;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };

    /** Who can be sent an annotation, for the participants picker. */
    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string };
        output: { members: AnnotationOrganizationMember[] };
      };
    };
  };

  project: {
    /** Whether a privacy rule hides input or output from this reader; one read per project. */
    getFieldRedactionStatus: {
      query: {
        input: ProjectScope;
        output: {
          isRedacted: { input: boolean; output: boolean };
          visibleTo: { input: string | null; output: string | null };
        };
      };
    };
  };
};

/** Everything this family calls: the two declared namespaces plus the borrowed three. */
type AnnotationProcedures = ContractApiMap<typeof annotationTrpc> &
  ContractApiMap<typeof annotationScoreTrpc> &
  BorrowedProcedures;

/** The annotations family's typed tRPC hooks; the screen mounts its Provider. */
export const annotationApi = createFeatureApi<AnnotationProcedures>();

/** The name the queue walker spells. */
export { annotationApi as api };

/** What each procedure answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<AnnotationProcedures>;
