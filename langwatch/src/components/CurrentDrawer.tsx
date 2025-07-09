/**
 * CurrentDrawer.tsx
 *
 * This file provides the global drawer system for the app.
 * It exposes:
 *   - <CurrentDrawer />: Renders the currently open drawer (if any) based on the URL query.
 *   - useDrawer(): Hook to open/close drawers programmatically.
 *
 * Drawers are registered in the `drawers` object below.
 *
 * # Example: Opening a Drawer
 *
 * import { useDrawer } from "./CurrentDrawer";
 *
 * const { openDrawer } = useDrawer();
 *
 * // To open the LLM Model Cost drawer:
 * openDrawer("llmModelCost", { id: "model-123" });
 *
 * // To open the Trace Details drawer:
 * openDrawer("traceDetails", { traceId: "abc123" });
 *
 * # Example: Closing a Drawer
 *
 * const { closeDrawer } = useDrawer();
 * closeDrawer();
 *
 * # Example: Checking if a Drawer is Open
 *
 * const { drawerOpen } = useDrawer();
 * if (drawerOpen("llmModelCost")) {
 *   // do something
 * }
 *
 * # Adding a New Drawer
 * 1. Create your drawer component (e.g., MyDrawer).
 * 2. Add it to the `drawers` object below with a unique key.
 * 3. Use `openDrawer("myDrawer", { ...props })` to open it.
 */

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
import { PromptAnalyticsDrawer } from "./PromptAnalyticsDrawer";
import { PromptTracesDrawer } from "./PromptTracesDrawer";
import { LLMModelCostDrawer } from "./settings/LLMModelCostDrawer";
import { TraceDetailsDrawer } from "./TraceDetailsDrawer";

type DrawerProps = {
  open: string;
} & Record<string, any>;

// Register all available drawers here.
// The key is used as the drawer name in openDrawer("key", ...).
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
  promptAnalytics: PromptAnalyticsDrawer,
  promptTraces: PromptTracesDrawer,
} satisfies Record<string, React.FC<any>>;

// workaround to pass complexProps to drawers
let complexProps = {} as Record<string, (...args: any[]) => void>;

/**
 * Renders the currently open drawer, if any.
 * Only one drawer can be open at a time.
 */
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
        // If a drawer errors, remove it from the URL to recover gracefully.
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

/**
 * useDrawer hook
 *
 * Provides methods to open, close, and check the state of drawers.
 *
 * Usage:
 *   const { openDrawer, closeDrawer, drawerOpen } = useDrawer();
 */
export function useDrawer() {
  const router = useRouter();

  /**
   * Opens a drawer by name, passing props to the drawer component.
   * Example: openDrawer("llmModelCost", { id: "model-123" });
   */
  const openDrawer = <T extends keyof typeof drawers>(
    drawer: T,
    props?: Parameters<(typeof drawers)[T]>[0],
    { replace }: { replace?: boolean } = {}
  ) => {
    // Only pass complex props (functions/objects) via global variable
    complexProps = Object.fromEntries(
      Object.entries(props ?? {}).filter(
        ([_key, value]) =>
          typeof value === "function" || typeof value === "object"
      )
    );

    void router[replace ? "replace" : "push"](
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

  /**
   * Closes any open drawer.
   */
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

  /**
   * Returns true if the given drawer is currently open.
   * Example: drawerOpen("llmModelCost")
   */
  const drawerOpen = (drawer: keyof typeof drawers) => {
    return router.query["drawer.open"] === drawer;
  };

  return { openDrawer, closeDrawer, drawerOpen };
}
