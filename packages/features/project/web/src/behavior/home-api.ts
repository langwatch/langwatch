/**
 * The procedures the project home calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, the line every feature family's
 * map carries: the procedure is mounted by the process, and the router type
 * does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. tRPC hashes the procedure path into the
 * React Query key, so `home`, `plan`, `integrationsChecks`, `analytics` and
 * `scenarios` are spelled exactly as the root router mounts them — the home's
 * recent-items read and the briefing's are ONE cache entry because they are the
 * same path with the same input, which is what the briefing's own comment says
 * it depends on.
 */

import type { TimeseriesBucket } from "@langwatch/analytics-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * What kind of thing the reader touched.
 *
 * `@langwatch/project-server`'s own union, restated rather than imported: a web
 * package may not name a server package, and this is the wire's vocabulary
 * either way.
 */
export type RecentItemType =
  | "prompt"
  | "workflow"
  | "dataset"
  | "evaluation"
  | "annotation"
  | "simulation";

/** One thing the reader touched recently, as the home lists it. */
export type RecentItem = {
  id: string;
  type: RecentItemType;
  name: string;
  href: string;
  updatedAt: Date;
};

export type HomeApiMap = {
  organization: {
    /**
     * The workspace graph, narrowed to the project the home is about.
     *
     * THE SAME PATH AND THE SAME INPUT the application shell asks with, which
     * under tRPC's path-plus-input cache key is the same entry: the home, the
     * sidebar and the two switchers read one workspace and cannot disagree
     * about which project is on screen.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              firstMessage?: boolean | null;
              /** The project's ingestion key, where the deployment hands it over. */
              apiKey?: string | null;
            }>;
          }>;
        }>;
      };
    };
  };

  home: {
    /** What this reader touched recently, newest first. */
    getRecentItems: {
      query: {
        input: { projectId: string; limit: number };
        output: RecentItem[];
      };
    };
  };

  plan: {
    /**
     * The organization's plan.
     *
     * Read for one branch: the "Considering LangWatch?" ask is offered to a
     * free organization and to nobody else, and "not answered yet" hides it —
     * a paying customer watching that pitch flash up is the product forgetting
     * who they are.
     */
    getActivePlan: {
      query: {
        input: { organizationId: string };
        output: { free: boolean; type?: string };
      };
    };
  };

  integrationsChecks: {
    /**
     * How far through setup this project is.
     *
     * THE SAME PATH AND INPUT the onboarding checklist, the setup hairline and
     * the home's own reach check all ask with, so React Query answers three
     * readers from one request and they can never disagree about whether the
     * project has data.
     */
    getCheckStatus: {
      query: {
        input: { projectId: string };
        output: {
          /** Whether a trace has ever arrived. The only boolean here. */
          firstMessage: boolean;
          /** The rest are COUNTS, and the checklist reads "more than none". */
          workflows: number;
          datasets: number;
          onlineEvaluations: number;
          simulations: number;
          modelProviders: number;
          prompts: number;
          teamMembers: number;
        };
      };
    };
  };

  analytics: {
    /**
     * The figures the briefing's vanity strip and its error line are drawn from.
     *
     * The input is the shared analytics filter shape, which this family neither
     * narrows nor validates — it composes one and hands it over — so it travels
     * as the record the procedure parses. The ANSWER is typed, because the
     * briefing reads buckets out of it by series name.
     */
    getTimeseries: {
      query: {
        input: Record<string, unknown>;
        output: {
          previousPeriod?: TimeseriesBucket[];
          currentPeriod?: TimeseriesBucket[];
        };
      };
    };
  };

  scenarios: {
    /** The simulation sets the briefing rolls up into one pass/fail line. */
    getExternalSetSummaries: {
      query: {
        input: { projectId: string };
        output: Array<{
          scenarioSetId: string;
          passedCount: number;
          failedCount: number;
          totalCount: number;
          lastRunTimestamp?: number | null;
        }>;
      };
    };
  };

  tracesV2: {
    /**
     * How often each value of one facet occurs in a window.
     *
     * Read for exactly one thing: the error-message shapes in this window
     * against the one before it, which is what turns "errors are up" into
     * "these errors are up". `totalDistinct` against the page length is how the
     * briefing knows whether it is comparing the whole set or a truncation.
     */
    facetValues: {
      query: {
        input: {
          projectId: string;
          timeRange: { from: number; to: number };
          facetKey: string;
          limit: number;
          offset: number;
        };
        output: {
          values: Array<{ value: string; count: number }>;
          totalDistinct: number;
        };
      };
    };
  };
};

export const homeApi = createFeatureApi<HomeApiMap>();
