import type { NextPage } from "next";
import type React from "react";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";

export interface Dependencies {
  SubscriptionPage?: React.FC;
  ExtraMenuItems?: React.FC;
  extraPagesRoutes?: Record<string, NextPage>;
  ExtraFooterComponents?: React.FC;
  managedModelProviderComponent?: (args: {
    projectId: string;
    organizationId: string;
    provider: MaybeStoredModelProvider;
  }) => React.FC<{ provider: MaybeStoredModelProvider }> | undefined;
}

const dependencies: Dependencies = {};

export default dependencies;
