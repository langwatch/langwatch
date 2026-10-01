/**
 * The procedures this package calls. The annotation and personal-workspace-features namespaces
 * are derived from their owners' contracts; the borrowed three belong to features not split yet.
 */

import type { annotationScoreTrpc, annotationTrpc } from "@langwatch/annotation-contract";
import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type { personalWorkspaceFeaturesTrpc } from "@langwatch/organization-contract";

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
        output: {
          id: string;
          name: string;
          teams: {
            id: string;
            name: string;
            isPersonal?: boolean;
            ownerUserId?: string | null;
            projects: { id: string; name: string; slug: string }[];
          }[];
        }[];
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

/** Everything this family calls: the three derived namespaces plus the borrowed three. */
type AnnotationProcedures = ContractApiMap<typeof annotationTrpc> &
  ContractApiMap<typeof annotationScoreTrpc> &
  ContractApiMap<typeof personalWorkspaceFeaturesTrpc> &
  BorrowedProcedures;

/** The annotations family's typed tRPC hooks; the screen mounts its Provider. */
export const annotationApi = createModuleApi<AnnotationProcedures>();

/** The name the queue walker spells. */
export { annotationApi as api };

/** What each procedure answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<AnnotationProcedures>;
