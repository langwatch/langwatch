/**
 * API procedures for onboarding. Segment names are load-bearing for React Query
 * cache keys. No credentials on this map.
 */

import type { OrganizationIntent } from "@langwatch/organization-contract";
import { createModuleApi } from "@langwatch/api/web";
import type { TimeInput } from "@langwatch/time";

/** What a signing-up reader told us about themselves, verbatim. */
type SignUpData = Readonly<Record<string, unknown>>;

export type OnboardingApiMap = {
  onboarding: {
    /**
     * Mints the reader's first organization, its team and — on the LLM Ops
     * track — its first project. The governance track answers a null
     * `projectSlug`, which is what sends that reader through the home resolver
     * instead of to a project.
     */
    initializeOrganization: {
      mutation: {
        input: {
          orgName: string;
          phoneNumber: string;
          primaryIntent: OrganizationIntent | undefined;
          signUpData: SignUpData;
        };
        output: { projectSlug: string | null };
      };
    };

    /** Records which flavour of integration the reader picked. */
    setIntegrationMethod: {
      mutation: {
        input: { integrationMethod: string; projectId?: string };
        output: unknown;
      };
    };
  };

  team: {
    /** The team the `/onboarding/:team/project` address names. */
    getBySlug: {
      query: {
        input: { slug: string; organizationId: string };
        output: { id: string; name: string; slug: string } | null;
      };
    };

    /** Every team the reader may put the new project in. */
    getTeamsWithMembers: {
      query: {
        input: { organizationId: string };
        output: Array<{ id: string; name: string; projects: Array<{ id: string }> }>;
      };
    };
  };

  project: {
    /** Creates the project the onboarding form describes. */
    create: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          teamId?: string;
          newTeamName?: string;
          language: string;
          framework: string;
        };
        output: { projectSlug: string };
      };
    };
  };

  traces: {
    /**
     * Polled by the "waiting for traces" chip. Only the GROUP COUNT is read —
     * the chip turns green on the first non-empty answer — so the payload is
     * declared as narrowly as it is used rather than restating the explorer's
     * row type, which is `@langwatch/trace-contract`'s.
     */
    getAllForProject: {
      query: {
        input: {
          projectId: string;
          startDate: number;
          endDate: number;
          filters: Readonly<Record<string, unknown>>;
          groupBy: string;
          pageSize: number;
        };
        /**
         * Grouped trace rows. The chip reads the COUNT and, on the first
         * arrival, one `trace_id` so it can link straight to the trace that
         * proved the integration works — nothing else off the row, which is why
         * the explorer's full type (`@langwatch/trace-contract`'s) is not
         * restated here.
         */
        output: { groups?: Array<Array<{ trace_id?: string }>> };
      };
    };
  };

  organization: {
    /**
     * Organization graph: path-plus-input cache key matches app shell. Row is
     * a wire view (membership, teams, projects, apiKey with redaction).
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          primaryIntent: string | null;
          teams: Array<{
            id: string;
            name: string;
            isPersonal?: boolean | null;
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              apiKey?: string | null;
              createdAt?: TimeInput | null;
            }>;
          }>;
        }>;
      };
    };
  };

  integrationsChecks: {
    /** The onboarding checklist's booleans, as the list renders them. */
    getCheckStatus: {
      query: {
        input: { projectId: string };
        output: {
          firstMessage: boolean;
          integrated: boolean;
          workflows: boolean;
          onlineEvaluations: boolean;
          triggers: boolean;
          datasets: boolean;
          customGraphs: boolean;
        };
      };
    };
  };
};

/**
 * The onboarding family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createModuleApi` for why separate instances still share cache entries.
 *
 * Exported as `api` as well, which is what let the moved call sites keep their
 * `api.onboarding.initializeOrganization.useMutation()` spelling unchanged.
 */
export const onboardingApi = createModuleApi<OnboardingApiMap>();

export const api = onboardingApi;
