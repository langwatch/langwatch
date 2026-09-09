/**
 * The sign-up ceremony: one organization, its first team, the standard AI-tool
 * catalogue, a personal workspace where the track calls for one, the first
 * project, and the announcements a sign-up leaves behind.
 *
 * Everything after the organization itself is non-fatal. The organization is
 * the durable outcome; a catalogue that was not seeded is provisioned by the
 * portal's own read, and a personal workspace that was not created is
 * recovered by the next session's backfill.
 */

import type {
  OnboardingInitializeOrganizationInput,
  OrganizationCaller,
  OrganizationInitialized,
  OrganizationIntent,
} from "@langwatch/organization-contract";
import { HandledError } from "@langwatch/handled-error";

import type {
  OrganizationCeremony,
  OrganizationSignals,
} from "../app/organization.infrastructure.ts";

/**
 * The intent that ends on the personal portal rather than in a project.
 * ADR-038 v6: a coding-agent sign-up gets a personal workspace and no shared
 * project; the organization creates one when it later flips to LLMOps.
 */
const CODING_AGENT_INTENT = "AGENT_GOVERNANCE";

/** What the ceremony creates the organization and everything after it through. */
export interface OrganizationOnboardingDependencies {
  readonly ceremony: OrganizationCeremony;
  readonly signals: OrganizationSignals;
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

export class OrganizationOnboardingService {
  static create(dependencies: OrganizationOnboardingDependencies): OrganizationOnboardingService {
    return new OrganizationOnboardingService(dependencies);
  }

  private constructor(private readonly deps: OrganizationOnboardingDependencies) {}

  async initialize(
    input: OnboardingInitializeOrganizationInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInitialized> {
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

      await this.#seedCatalogue(created.organization.id);

      // The coding-agent track lives on the personal portal, so its workspace
      // is provisioned here rather than on the first command-line sign-in:
      // otherwise the ending page shows an empty shell.
      if (input.primaryIntent === CODING_AGENT_INTENT) {
        await this.#provisionPersonalWorkspace({ organizationId: created.organization.id, by });
      }

      const projectSlug =
        input.primaryIntent === CODING_AGENT_INTENT
          ? null
          : await this.#createFirstProject({ input, created, by });

      await this.#announce({ input, organizationName: created.organization.name, by });

      this.deps.signals.fireSignupNurturing({
        userId: by.id,
        email: by.email ?? null,
        name: by.name ?? null,
        organizationId: created.organization.id,
        organizationName: created.organization.name,
        signUpData: input.signUpData,
        primaryIntent: input.primaryIntent,
      });

      // A null slug is how the client knows to land on the personal portal
      // rather than in a project.
      return {
        success: true,
        teamSlug: created.team.slug,
        teamName: created.team.name,
        teamId: created.team.id,
        organizationId: created.organization.id,
        projectSlug,
      };
    } catch (error) {
      this.deps.signals.reportError(error);
      throw error;
    }
  }

  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void {
    this.deps.signals.recordIntegrationMethod(input);
  }

  /**
   * Every new organization gets the standard catalogue at creation, whatever
   * its intent, so the portal renders tiles on its first load.
   */
  async #seedCatalogue(organizationId: string): Promise<void> {
    try {
      await this.deps.ceremony.ensureDefaultAiToolCatalog({ organizationId });
    } catch (error) {
      this.deps.signals.reportError(error, {
        extra: {
          origin: "onboarding.initializeOrganization.ensureDefaultCatalog",
          organizationId,
        },
      });
    }
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

  async #createFirstProject(input: {
    input: OnboardingInitializeOrganizationInput;
    created: Readonly<{
      organization: Readonly<{ id: string }>;
      team: Readonly<{ id: string; name: string }>;
    }>;
    by: OrganizationCaller;
  }): Promise<string> {
    const result = await this.deps.ceremony.createProject({
      organizationId: input.created.organization.id,
      teamId: input.created.team.id,
      // The organization's own team names the project when the customer did
      // not: at this point in the ceremony it is the only name they have given.
      name: input.input.projectName ?? input.created.team.name,
      language: input.input.language,
      framework: input.input.framework,
      userId: input.by.id,
    });

    if (!result.success) throw new OnboardingProjectNotCreatedError();

    return result.projectSlug;
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

/**
 * The organization was created and its first project was not. Handled because
 * the customer can act on it - the project screen creates one directly - and
 * because an unnamed 500 here reads as "sign-up is broken" when it is not.
 */
class OnboardingProjectNotCreatedError extends HandledError {
  declare readonly code: "project_creation_failed";

  constructor() {
    super(
      "project_creation_failed",
      "The organization was created, but its first project was not",
      {
        httpStatus: 500,
        fault: "platform",
      },
    );
    this.name = "OnboardingProjectNotCreatedError";
  }
}
