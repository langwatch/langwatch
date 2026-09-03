/**
 * Which page keys the Datasets addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS. The keys still read `pages/[project]/datasets` and
 * `pages/[project]/datasets/[id]`, and they are kept rather than renamed: the
 * route transcript in `apps/ui/tests/fixtures` is the parity bar for the URL
 * surface and fails the moment a page key changes, so renaming one would spend
 * that guard's signal on a cosmetic edit. Every family before this one left its
 * keys alone for the same reason.
 *
 * Each page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the Datasets host, but a page that opens needs the host mounted
 * above it before its first render. Inside that, the guard states the policy the
 * platform higher-order component carried.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE, AND THEY DIFFER FROM EACH
 * OTHER: the list page was wrapped in `withPermissionGuard("datasets:view")`,
 * and the detail page was NOT wrapped at all — it read `hasPermission` only to
 * decide whether to offer the Run experiment button. So the list key carries the
 * grant and the detail key carries none, which is the behaviour a reader with a
 * deep link into one dataset has today. `layoutComponent: DashboardLayout` was
 * the other half of the list page's call and does not travel — chrome belongs to
 * the route tree, and these pages are children of a layout route the composing
 * application still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { datasetScreens } from "@langwatch/dataset-web/screens/datasets";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { DATASET_PAGE_PERMISSION } from "../../behavior/dataset-host.adapter";
import { withDatasetHost } from "./dataset-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const datasetsListPage: UiPageLoader = async () => {
  const module = await datasetScreens.datasets();
  const guarded = withUiPageGuard({
    permission: DATASET_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withDatasetHost(guarded) };
};

const datasetEditorPage: UiPageLoader = async () => {
  const module = await datasetScreens.datasetEditor();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  return { default: withDatasetHost(guarded) };
};

export const datasetPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/datasets": datasetsListPage,
  "pages/[project]/datasets/[id]": datasetEditorPage,
};
