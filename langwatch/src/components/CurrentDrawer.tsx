import { useRouter } from "next/router";
import qs from "qs";
import { ErrorBoundary } from "react-error-boundary";

import { AddAnnotationQueueDrawer } from "./AddAnnotationQueueDrawer";
import { AddDatasetRecordDrawerV2 } from "./AddDatasetRecordDrawer";
import { AddOrEditAnnotationScoreDrawer } from "./AddOrEditAnnotationScoreDrawer";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { TriggerDrawer } from "./AddTriggerDrawer";
import { BatchEvaluationDrawer } from "./BatchEvaluationDrawer";
import { UploadCSVModal } from "./datasets/UploadCSVModal";
import { EditTriggerFilterDrawer } from "./EditTriggerFilterDrawer";
import { LLMModelCostDrawer } from "./settings/LLMModelCostDrawer";
import { TraceDetailsDrawer } from "./TraceDetailsDrawer";

import { createLogger } from "~/utils/logger";

const logger = createLogger("CurrentDrawer");

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

  const openDrawerAsync = <T extends keyof typeof drawers>(
    drawer: T,
    props?: Parameters<(typeof drawers)[T]>[0],
    { replace }: { replace?: boolean } = {}
  ) => {
    complexProps = Object.fromEntries(
      Object.entries(props ?? {}).filter(
        ([_key, value]) =>
          typeof value === "function" || typeof value === "object"
      )
    );

    return router[replace ? "replace" : "push"](
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

  const closeDrawerAsync = (options: { shallow?: boolean } = {}) => {
    return router.push(
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
      { shallow: options.shallow ?? true }
    );
  };

  const drawerOpen = (drawer: keyof typeof drawers) => {
    return router.query["drawer.open"] === drawer;
  };

  return {
    openDrawer: (...args: Parameters<typeof openDrawerAsync>) => {
      return void openDrawerAsync(...args).catch((e) => {
        logger.error("openDrawer", e);
      });
    },
    openDrawerAsync,
    closeDrawer: () => {
      return void closeDrawerAsync().catch((e) => {
        logger.error("closeDrawer", e);
      });
    },
    closeDrawerAsync,
    drawerOpen,
  };
}
