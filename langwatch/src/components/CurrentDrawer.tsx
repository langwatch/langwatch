import { useRouter } from "next/router";
import qs from "qs";
import { TraceDetailsDrawer } from "./TraceDetailsDrawer";
import { BatchEvaluationDrawer } from "./BatchEvaluationDrawer";
import { TriggerDrawer } from "./AddTriggerDrawer";
import { AnnotationDrawer } from "./AnnotationDrawer";
import { AddAnnotationScoreDrawer } from "./AddAnnotationScoreDrawer";
import { AddDatasetRecordDrawerV2 } from "./AddDatasetRecordDrawer";
import { LLMModelCostDrawer } from "./settings/LLMModelCostDrawer";
import { UploadCSVModal } from "./datasets/UploadCSVModal";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { ErrorBoundary } from "react-error-boundary";

type DrawerProps = {
  open: string;
} & Record<string, any>;

const drawers = {
  traceDetails: TraceDetailsDrawer,
  batchEvaluation: BatchEvaluationDrawer,
  trigger: TriggerDrawer,
  annotation: AnnotationDrawer,
  addAnnotationScore: AddAnnotationScoreDrawer,
  addDatasetRecord: AddDatasetRecordDrawerV2,
  llmModelCost: LLMModelCostDrawer,
  uploadCSV: UploadCSVModal,
  addOrEditDataset: AddOrEditDatasetDrawer,
} satisfies Record<string, React.FC<any>>;

// workaround to pass complexProps to drawers
let complexProps = {} as Record<string, (...args: any[]) => void>;

export function CurrentDrawer() {
  const router = useRouter();

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
                  ([key]) => !key.startsWith("drawer.")
                )
              )
            ),
          undefined,
          { shallow: true }
        );
      }}
    >
      <CurrentDrawer {...queryDrawer} {...complexProps} />
    </ErrorBoundary>
  ) : null;
}

export function useDrawer() {
  const router = useRouter();

  const openDrawer = <T extends keyof typeof drawers>(
    drawer: T,
    props: Parameters<(typeof drawers)[T]>[0]
  ) => {
    complexProps = Object.fromEntries(
      Object.entries(props ?? {}).filter(
        ([_key, value]) =>
          typeof value === "function" || typeof value === "object"
      )
    );

    void router.push(
      "?" +
        qs.stringify(
          {
            ...Object.fromEntries(
              Object.entries(router.query).filter(
                ([key, value]) =>
                  !key.startsWith("drawer.") &&
                  typeof value !== "function" &&
                  typeof value !== "object"
              )
            ),
            drawer: {
              open: drawer,
              ...props,
            },
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          }
        ),
      undefined,
      { shallow: true }
    );
  };

  const closeDrawer = () => {
    void router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(router.query).filter(
              ([key]) => !key.startsWith("drawer.") && key !== "span" // remove span key as well left by trace details
            )
          ),
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          }
        ),
      undefined,
      { shallow: true }
    );
  };

  const isDrawerOpen = (drawer: keyof typeof drawers) => {
    return router.query["drawer.open"] === drawer;
  };

  return { openDrawer, closeDrawer, isDrawerOpen };
}
