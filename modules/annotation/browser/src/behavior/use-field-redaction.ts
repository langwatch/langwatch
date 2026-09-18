/**
 * Whether captured input and output are readable in this project, and by whom.
 * Both fields come from one read; there is no share-page escape hatch here.
 */

import { annotationApi } from "./annotation-api.ts";

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
