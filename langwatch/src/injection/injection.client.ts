import type { NextPage } from "next";
import type React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";

export interface Dependencies {
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
  hasNegateFilters?: ({ projectId }: { projectId: string }) => boolean;
}

const dependencies: Dependencies = {};

export default dependencies;
