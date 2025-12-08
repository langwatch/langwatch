import { useRouter } from "next/router";
import qs from "qs";

/**
 * Drawer type registry. Add new drawer types here.
 */
export type DrawerType =
  | "traceDetails"
  | "batchEvaluation"
  | "trigger"
  | "addOrEditAnnotationScore"
  | "addAnnotationQueue"
  | "addDatasetRecord"
  | "llmModelCost"
  | "uploadCSV"
  | "addOrEditDataset"
  | "editTriggerFilter"
  | "seriesFilters";

/** Generic callback type for drawer props - callers must narrow before use */
type DrawerCallback = (...args: unknown[]) => void;

// workaround to pass complexProps to drawers
let complexProps = {} as Record<string, DrawerCallback>;

export function getComplexProps() {
  return complexProps;
}

/**
 * Hook to manage drawer state via URL query params.
 */
export function useDrawer() {
  const router = useRouter();

  const openDrawer = <T extends DrawerType>(
    drawer: T,
    props?: Record<string, unknown>,
    { replace }: { replace?: boolean } = {},
  ) => {
    complexProps = Object.fromEntries(
      Object.entries(props ?? {}).filter(
        ([_key, value]) =>
          typeof value === "function" || typeof value === "object",
      ),
    ) as Record<string, DrawerCallback>;

    void router[replace ? "replace" : "push"](
      "?" +
        qs.stringify(
          {
            ...Object.fromEntries(
              Object.entries(router.query).filter(
                ([key, value]) =>
                  !key.startsWith("drawer.") &&
                  typeof value !== "function" &&
                  typeof value !== "object",
              ),
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
          },
        ),
      undefined,
      { shallow: true },
    );
  };

  const closeDrawer = () => {
    void router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(router.query).filter(
              ([key]) => !key.startsWith("drawer.") && key !== "span", // remove span key as well left by trace details
            ),
          ),
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true },
    );
  };

  const drawerOpen = (drawer: DrawerType) => {
    return router.query["drawer.open"] === drawer;
  };

  return { openDrawer, closeDrawer, drawerOpen };
}

