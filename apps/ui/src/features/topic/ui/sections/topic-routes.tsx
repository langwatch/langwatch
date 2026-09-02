/**
 * Which page key the Topic Clustering address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as every
 * other settings family: the host outermost, the harvested settings chrome
 * inside it, and the platform page's own `project:manage` grant innermost — so
 * a refusal is framed by the settings menu, exactly as
 * `withPermissionGuard({ layoutComponent: SettingsLayout })` framed its own.
 */

import { topicScreens } from "@langwatch/topic-web/screens/topic-clustering";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { TOPIC_CLUSTERING_PAGE_PERMISSION } from "../../behavior/topic-host.adapter";
import { withTopicHost } from "./topic-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const topicClusteringPage: UiPageLoader = async () => {
  const module = await topicScreens.topicClustering();
  const guarded = withUiPageGuard({
    permission: TOPIC_CLUSTERING_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "TopicClusteringPage";
  return { default: withTopicHost(withUiSettingsLayout(guarded)) };
};

export const topicPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/topic-clustering": topicClusteringPage,
};
