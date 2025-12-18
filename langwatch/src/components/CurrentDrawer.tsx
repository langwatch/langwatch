import { useRouter } from "next/router";
import qs from "qs";
import { ErrorBoundary } from "react-error-boundary";
import { getComplexProps } from "../hooks/useDrawer";
import { AddAnnotationQueueDrawer } from "./AddAnnotationQueueDrawer";
import { AddDatasetRecordDrawerV2 } from "./AddDatasetRecordDrawer";
import { AddOrEditAnnotationScoreDrawer } from "./AddOrEditAnnotationScoreDrawer";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { TriggerDrawer } from "./AddTriggerDrawer";
import { BatchEvaluationDrawer } from "./BatchEvaluationDrawer";
import { UploadCSVModal } from "./datasets/UploadCSVModal";
import { EditTriggerFilterDrawer } from "./EditTriggerFilterDrawer";
import { SeriesFiltersDrawer } from "./SeriesFilterDrawer";
import { LLMModelCostDrawer } from "./settings/LLMModelCostDrawer";
import { TraceDetailsDrawer } from "./TraceDetailsDrawer";
import { AlertDrawer } from "../pages/[project]/analytics/custom/AlertDrawer";

// Re-export for backward compatibility (useDrawer moved to hooks/useDrawer.ts)
export { useDrawer } from "../hooks/useDrawer";

type DrawerProps = {
  open: string;
} & Record<string, any>;

const drawers = {
  traceDetails: TraceDetailsDrawer,
  batchEvaluation: BatchEvaluationDrawer,
  trigger: TriggerDrawer,
  addOrEditAnnotationScore: AddOrEditAnnotationScoreDrawer,
  addAnnotationQueue: AddAnnotationQueueDrawer,
  addDatasetRecord: AddDatasetRecordDrawerV2,
  llmModelCost: LLMModelCostDrawer,
  uploadCSV: UploadCSVModal,
  addOrEditDataset: AddOrEditDatasetDrawer,
  editTriggerFilter: EditTriggerFilterDrawer,
  seriesFilters: SeriesFiltersDrawer,
  customGraphAlert: AlertDrawer,
} satisfies Record<string, React.FC<any>>;

export function CurrentDrawer() {
  const router = useRouter();
  const complexProps = getComplexProps();
  const queryString = router.asPath.split("?")[1] ?? "";
  const queryParams = qs.parse(queryString.replaceAll("%2C", ","), {
    allowDots: true,
    comma: true,
    allowEmptyArrays: true,
  });
  const queryDrawer = queryParams.drawer as DrawerProps | undefined;

  const CurrentDrawer = queryDrawer
    ? (drawers[queryDrawer.open as keyof typeof drawers] as React.FC<any>)
    : undefined;

  return CurrentDrawer ? (
    <ErrorBoundary
      fallback={null}
      onError={() => {
        void router.push(
          "?" +
            qs.stringify(
              Object.fromEntries(
                Object.entries(router.query).filter(
                  ([key]) => !key.startsWith("drawer."),
                ),
              ),
            ),
          undefined,
          { shallow: true },
        );
      }}
    >
      <CurrentDrawer {...queryDrawer} {...complexProps} />
    </ErrorBoundary>
  ) : null;
}
