/**
 * API procedures for onboarding. Segment names are load-bearing for React Query
 * cache keys. No credentials on this map.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type {
  GuidedOnboardingState as GuidedState,
  GuidedOnboardingStateWithInstance as GuidedStateWithInstance,
  GuidedOnboardingStateWithVariant as GuidedStateWithVariant,
} from "@langwatch/onboarding-contract";
import type {
  joinRequestTrpc,
  OrganizationInitialized,
  OrganizationIntent,
} from "@langwatch/organization-contract";
import type { TimeInput } from "@langwatch/time";

/** What a signing-up reader told us about themselves, verbatim. */
type SignUpData = Readonly<Record<string, unknown>>;

/** `joinRequests.lookup` feeds the create screen's join-instead notice. */
export type OnboardingApiMap = ContractApiMap<typeof joinRequestTrpc> & {
  organization: {
    /**
     * Mints the reader's first organization, its team and, on the LLM Ops
     * track, its first project. The governance track answers a null
     * `projectSlug`, sending that reader through the home resolver instead.
     */
    initializeOrganization: {
      mutation: {
        input: {
          orgName: string;
          phoneNumber: string;
          primaryIntent: OrganizationIntent | undefined;
          signUpData: SignUpData;
        };
        output: OrganizationInitialized;
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

  onboarding: {
    /** The guided takeover/tour's durable state, plus the variant it was assigned. */
    getGuidedState: {
      query: {
        input: { organizationId: string };
        output: GuidedStateWithVariant;
      };
    };

    /** Records the paths picked on the value screen, in pick order. */
    recordPaths: {
      mutation: {
        input: { organizationId: string; paths: string[] };
        output: GuidedState;
      };
    };

    /** Records the provider the reader connected on the provider screen. */
    recordProvider: {
      mutation: {
        input: { organizationId: string; provider: string; model: string };
        output: GuidedState;
      };
    };

    /** Records that the reader skipped connecting a provider. */
    recordProviderSkipped: {
      mutation: {
        input: { organizationId: string };
        output: GuidedState;
      };
    };

    /** Records a virtual key the gateway tour minted, for the secret snippet card. */
    recordVirtualKeyReveal: {
      mutation: {
        input: { organizationId: string; name: string; preview: string; revealId: string };
        output: GuidedState;
      };
    };

    /** Records the tour's outcome: completed, skipped, or replayed. */
    recordTour: {
      mutation: {
        input: { organizationId: string; status: "completed" | "skipped" | "replayed" };
        output: GuidedState;
      };
    };

    /** Marks a path as the one Langy is guiding now. */
    beginPath: {
      mutation: {
        input: { organizationId: string; path: string };
        output: GuidedStateWithInstance;
      };
    };

    /** Marks a path done. */
    completePath: {
      mutation: {
        input: { organizationId: string; path: string };
        output: GuidedState;
      };
    };

    /** Attaches the Langy conversation the kickoff started to the organization. */
    attachConversation: {
      mutation: {
        input: { organizationId: string; conversationId: string };
        output: GuidedState;
      };
    };
  };

  modelProvider: {
    /**
     * Borrowed from model-provider's contract (`setRoleAssignmentForScope`):
     * points a model role at a scope. The guided takeover uses it to point
     * Langy's own role at the model the reader just connected.
     */
    setRoleAssignmentForScope: {
      mutation: {
        input: {
          scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
          scopeId: string;
          role: "DEFAULT" | "FAST" | "LANGY" | "EMBEDDINGS";
          model: string | null;
        };
        output: { ok: true };
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
        output: { id: string; name: string; projects: { id: string }[] }[];
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
     * declared as narrowly as used, not restating `@langwatch/trace-contract`'s row type.
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
         * Grouped trace rows. The chip reads the COUNT and, on first arrival,
         * one `trace_id` to link straight to the trace proving the
         * integration works — nothing else, so the explorer's full type isn't restated.
         */
        output: { groups?: { trace_id?: string }[][] };
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
        output: {
          id: string;
          name: string;
          primaryIntent: string | null;
          teams: {
            id: string;
            name: string;
            isPersonal?: boolean | null;
            projects: {
              id: string;
              name: string;
              slug: string;
              apiKey?: string | null;
              createdAt?: TimeInput | null;
            }[];
          }[];
        }[];
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
 * The onboarding family's typed tRPC hooks — same machinery, transport and
 * cache as the application's `api` proxy (see `createModuleApi`). Also
 * exported as `api`, so call sites read `api.<namespace>.<procedure>`.
 */
export const onboardingApi = createModuleApi<OnboardingApiMap>();

export const api = onboardingApi;
