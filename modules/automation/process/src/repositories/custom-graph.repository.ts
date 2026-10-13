import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";

export abstract class CustomGraphRepository {
  abstract findById(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null>;
  abstract existsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean>;
  abstract findAllNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]>;
  /**
   * Every panel on one dashboard, in the dashboard's own grid order: the
   * read's order, not the caller's, so two callers can't disagree about
   * what "the dashboard" looks like.
   */
  abstract findAllByDashboardId(input: {
    dashboardId: string;
    projectId: string;
  }): Promise<CustomGraph[]>;
}
