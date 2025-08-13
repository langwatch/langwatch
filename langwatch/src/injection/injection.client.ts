import type { NextPage } from "next";
import type React from "react";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import type { UseFormReturn } from "react-hook-form";

export interface Dependencies {
  SubscriptionPage?: React.FC;
  ExtraMenuItems?: React.FC;
  extraPagesRoutes?: Record<string, NextPage>;
  ExtraFooterComponents?: React.FC;
  managedModelProviderComponent?: (args: {
    projectId: string;
    organizationId: string;
    provider: MaybeStoredModelProvider;
  }) =>
    | React.FC<{
        provider: MaybeStoredModelProvider;
        form: UseFormReturn<any>;
      }>
    | undefined;
}

const dependencies: Dependencies = {};

export default dependencies;
