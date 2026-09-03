import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";

export abstract class CustomGraphRepository {
  abstract tryFindById(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null>;
  abstract existsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean>;
  abstract findAllNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]>;
  /**
   * Every panel on one dashboard, in the dashboard's own grid order.
   *
   * The order is the read's, not the caller's: a dashboard report sends one
   * chart per panel and the reader expects them in the order they are laid out
   * on screen, so sorting after the fact would let two callers disagree about
   * what "the dashboard" looks like.
   */
  abstract findAllByDashboardId(input: {
    dashboardId: string;
    projectId: string;
  }): Promise<CustomGraph[]>;
}
