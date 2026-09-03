/**
 * Whether captured input and output are readable in this project, and by whom.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/hooks/useFieldRedaction`, which
 * keeps its callers across the trace surfaces.
 *
 * NARROWED IN ONE WAY THAT MATTERS: the platform hook opens with a
 * `window.location.pathname.includes("/share/")` escape hatch that returns
 * "nothing is redacted" on a public share page. These screens are not reachable
 * from a share link — a share page renders one trace, never a queue — and a
 * governed screen closure may not read `location` in any case, so the escape
 * hatch did not travel. Both fields are asked for once and answered together,
 * which is what the one procedure returns.
 */

import { annotationApi } from "./annotation-api";

export type FieldRedactionReading = {
  isRedacted: boolean | undefined;
  isLoading: boolean;
  visibleTo: string | null;
};

export function useFieldRedaction({
  projectId,
  canRead,
}: {
  projectId: string | undefined;
  /** `project:view`, which is what the procedure's own policy asks for. */
  canRead: boolean;
}): { input: FieldRedactionReading; output: FieldRedactionReading } {
  const reading = annotationApi.project.getFieldRedactionStatus.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: !!projectId && canRead,
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  const forField = (field: "input" | "output"): FieldRedactionReading => ({
    isRedacted: reading.isLoading ? void 0 : (reading.data?.isRedacted[field] ?? false),
    isLoading: reading.isLoading,
    visibleTo: reading.data?.visibleTo[field] ?? null,
  });

  return { input: forField("input"), output: forField("output") };
}
