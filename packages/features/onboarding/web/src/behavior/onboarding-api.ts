/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `api-key-api.ts`,
 * `trace-api.ts`, `auth-api.ts` and every map since the governance family say of
 * their own: the procedures are mounted by the process out of the server
 * packages, which a web package may not import even for a type, and the router
 * type does not exist until a process instantiates it.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `onboarding`, `team`, `project`, `traces`
 * and `integrationsChecks` are mount points on the root router and tRPC hashes
 * that path into the React Query cache key; spell one differently and these
 * hooks quietly stop sharing a cache with the call sites that have not moved.
 *
 * ## NOTHING ON THIS MAP CARRIES A CREDENTIAL
 *
 * The setup guide prints the project's legacy base key, and it does NOT come
 * from here: it is `revealProjectApiKey()` on the host port, answered off the
 * organization graph the application shell already holds, under the server-side
 * `project:update` redaction. Adding a key-bearing read to this map would be a
 * wire change and a decision, not an addition.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import type { OrganizationIntent } from "@langwatch/organization-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

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
     * The reader's organization graph, asked with the same input the application
     * shell asks with — under tRPC's path-plus-input cache key that is the same
     * entry, so the graph is fetched once for the document however many halves of
     * the product want it.
     *
     * The declared row is a VIEW of the wire, not the whole of it: what the
     * welcome redirect walks (membership, shared teams, their projects), what the
     * product flow's "skip to my project" link needs, and `apiKey`, which is the
     * one field the setup guide reads and which the server has already redacted
     * to `""` for a reader without `project:update`.
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
              createdAt?: string | Date | null;
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
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * Exported as `api` as well, which is what let the moved call sites keep their
 * `api.onboarding.initializeOrganization.useMutation()` spelling unchanged.
 */
export const onboardingApi = createFeatureApi<OnboardingApiMap>();

export const api = onboardingApi;
