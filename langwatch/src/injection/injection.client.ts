import type { NextPage } from "next";
import type React from "react";

export interface Dependencies {
  SubscriptionPage?: React.FC;
  ExtraMenuItems?: React.FC;
  extraPagesRoutes?: Record<string, NextPage>;
  ExtraFooterComponents?: React.FC;
  ExtraFooterComponentsScripts?: React.FC;
}

const dependencies: Dependencies = {};

export default dependencies;
