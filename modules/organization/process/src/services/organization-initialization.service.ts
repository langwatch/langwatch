/** Sign-up ceremony: organization is durable; everything after is non-fatal. */

import type {
  OnboardingInitializeOrganizationInput,
  OrganizationInitialized,
} from "@langwatch/onboarding-contract";
import type { OrganizationCaller, OrganizationIntent } from "@langwatch/organization-contract";

import type { OrganizationLifecycleNoticeService } from "./organization-lifecycle-notice.service.ts";
import type { OrganizationSignals } from "./organization-signals.service.ts";

/**
 * The intent that ends on the personal portal rather than in a project.
 * ADR-038 v6: a coding-agent sign-up gets a personal workspace; onboarding
 * creates the shared first project for every other intent.
 */
const CODING_AGENT_INTENT = "AGENT_GOVERNANCE";

/** What the ceremony creates the organization and everything after it through. */
interface OrganizationInitializationDependencies {
  readonly signals: OrganizationSignals;
  /** Where the sign-up is recorded as organization's event, for nurturing. */
  readonly lifecycle: Pick<
    OrganizationLifecycleNoticeService,
    "signedUp" | "integrationMethodChosen"
  >;
  createAndAssign(
    input: Readonly<{
      orgName?: string | undefined;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
      primaryIntent?: OrganizationIntent | null | undefined;
      userDisplayName?: string | null;
    }>,
    by: OrganizationCaller,
  ): Promise<
    Readonly<{
      organization: Readonly<{ id: string; name: string }>;
      team: Readonly<{ id: string; slug: string; name: string }>;
    }>
  >;
  ensurePersonalWorkspace(
    input: Readonly<{
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    }>,
    by: OrganizationCaller,
  ): Promise<unknown>;
}

export class OrganizationInitializationService {
  static create(
    dependencies: OrganizationInitializationDependencies,
  ): OrganizationInitializationService {
    return new OrganizationInitializationService(dependencies);
  }

  private constructor(private readonly deps: OrganizationInitializationDependencies) {}

  async initialize(
    input: OnboardingInitializeOrganizationInput,
    by: OrganizationCaller,
  ): Promise<Omit<OrganizationInitialized, "projectSlug">> {
    try {
      const created = await this.deps.createAndAssign(
        {
          orgName: input.orgName,
          phoneNumber: input.phoneNumber,
          signUpData: input.signUpData,
          primaryIntent: input.primaryIntent,
          userDisplayName: by.name,
        },
        by,
      );

      // The coding-agent track lives on the personal portal, so its workspace
      // is provisioned here rather than on the first command-line sign-in:
      // otherwise the ending page shows an empty shell.
      if (input.primaryIntent === CODING_AGENT_INTENT) {
        await this.#provisionPersonalWorkspace({ organizationId: created.organization.id, by });
      }

      await this.#announce({ input, organizationName: created.organization.name, by });

      this.deps.lifecycle.signedUp({
        userId: by.id,
        organizationId: created.organization.id,
        organizationName: created.organization.name,
        signUpData: input.signUpData,
        primaryIntent: input.primaryIntent,
      });

      return {
        success: true,
        teamSlug: created.team.slug,
        teamName: created.team.name,
        teamId: created.team.id,
        organizationId: created.organization.id,
      };
    } catch (error) {
      this.deps.signals.reportError(error);
      throw error;
    }
  }

  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void {
    this.deps.lifecycle.integrationMethodChosen(input);
  }

  async #provisionPersonalWorkspace(input: {
    organizationId: string;
    by: OrganizationCaller;
  }): Promise<void> {
    try {
      await this.deps.ensurePersonalWorkspace(
        {
          organizationId: input.organizationId,
          displayName: input.by.name,
          displayEmail: input.by.email,
        },
        input.by,
      );
    } catch (error) {
      this.deps.signals.reportError(error, {
        extra: {
          origin: "onboarding.initializeOrganization",
          organizationId: input.organizationId,
        },
      });
    }
  }

  /** Marketing traffic, never fatal: a sign-up that was not announced still happened. */
  async #announce(input: {
    input: OnboardingInitializeOrganizationInput;
    organizationName: string;
    by: OrganizationCaller;
  }): Promise<void> {
    const payload = {
      userName: input.by.name,
      userEmail: input.by.email ?? null,
      organizationName: input.organizationName,
      phoneNumber: input.input.phoneNumber,
      signUpData: input.input.signUpData,
    };

    try {
      await Promise.all([
        this.deps.signals.sendSlackSignupEvent(payload),
        this.deps.signals.sendHubspotSignupForm(payload),
      ]);
    } catch (error) {
      this.deps.signals.reportError(error);
    }
  }
}
