// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { z } from "zod";

export const governanceOrganizationIntentSchema = z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]);
export type GovernanceOrganizationIntent = z.infer<typeof governanceOrganizationIntentSchema>;

export const personaSchema = z.enum(["personal_only", "mixed", "project_only", "governance_admin"]);
export type Persona = z.infer<typeof personaSchema>;

export const personaResolverInputSchema = z
  .object({
    organizationIntent: governanceOrganizationIntentSchema.nullable(),
    userLastHomePath: z.string().nullable(),
    setupState: z
      .object({
        hasPersonalVKs: z.boolean(),
        hasIngestionSources: z.boolean(),
        hasRecentActivity: z.boolean(),
      })
      .strict(),
    hasApplicationTraces: z.boolean(),
    hasOrganizationManagePermission: z.boolean(),
    isEnterprise: z.boolean(),
    hasGovernanceUi: z.boolean(),
    firstProjectSlug: z.string().nullable(),
  })
  .strict();
export type PersonaResolverInput = z.infer<typeof personaResolverInputSchema>;

export const personaResolutionSchema = z
  .object({
    persona: personaSchema,
    destination: z.string(),
    isOverride: z.boolean(),
    governanceUiEnabled: z.boolean(),
    intentPinned: z.boolean(),
    /**
     * The same filtered project the resolver would route to — never a
     * personal workspace (ADR-038 v6). Callers offering a "project home"
     * option (the picker) must use this rather than an unfiltered query.
     */
    firstProjectSlug: z.string().nullable(),
  })
  .strict();
export type PersonaResolution = z.infer<typeof personaResolutionSchema>;

/** Pure home-routing policy. All I/O is resolved before this class is called. */
export class PersonaHomeResolverService {
  static create(): PersonaHomeResolverService {
    return new PersonaHomeResolverService();
  }

  resolve(input: PersonaResolverInput): PersonaResolution {
    const persona = this.detectPersona(input);

    if (input.organizationIntent) {
      const projectHome = input.firstProjectSlug ? `/${input.firstProjectSlug}` : "/settings";
      return {
        persona,
        destination:
          input.organizationIntent === "AGENT_GOVERNANCE" && input.hasGovernanceUi
            ? "/me"
            : projectHome,
        isOverride: false,
        governanceUiEnabled: input.hasGovernanceUi,
        intentPinned: true,
        firstProjectSlug: input.firstProjectSlug,
      };
    }

    if (input.userLastHomePath) {
      return {
        persona,
        destination: input.userLastHomePath,
        isOverride: true,
        governanceUiEnabled: input.hasGovernanceUi,
        intentPinned: false,
        firstProjectSlug: input.firstProjectSlug,
      };
    }

    return {
      persona,
      destination: this.mapPersonaToDestination(persona, input),
      isOverride: false,
      governanceUiEnabled: input.hasGovernanceUi,
      intentPinned: false,
      firstProjectSlug: input.firstProjectSlug,
    };
  }

  /** Fail-safe used at transport boundaries when upstream signals are partial. */
  resolveSafe(
    input: Partial<PersonaResolverInput> & { firstProjectSlug: string | null },
  ): PersonaResolution {
    try {
      return this.resolve({
        organizationIntent: input.organizationIntent ?? null,
        userLastHomePath: input.userLastHomePath ?? null,
        setupState: input.setupState ?? {
          hasPersonalVKs: false,
          hasIngestionSources: false,
          hasRecentActivity: false,
        },
        hasApplicationTraces: input.hasApplicationTraces ?? false,
        hasOrganizationManagePermission: input.hasOrganizationManagePermission ?? false,
        isEnterprise: input.isEnterprise ?? false,
        hasGovernanceUi: input.hasGovernanceUi ?? false,
        firstProjectSlug: input.firstProjectSlug,
      });
    } catch {
      return {
        persona: "project_only",
        destination: input.firstProjectSlug ? `/${input.firstProjectSlug}` : "/me",
        isOverride: false,
        governanceUiEnabled: input.hasGovernanceUi ?? false,
        intentPinned: false,
        firstProjectSlug: input.firstProjectSlug,
      };
    }
  }

  private detectPersona(input: PersonaResolverInput): Persona {
    if (
      input.hasOrganizationManagePermission &&
      input.isEnterprise &&
      input.setupState.hasIngestionSources
    ) {
      return "governance_admin";
    }
    if (input.setupState.hasPersonalVKs && input.firstProjectSlug) {
      return "mixed";
    }
    if (input.setupState.hasPersonalVKs) return "personal_only";
    return "project_only";
  }

  private mapPersonaToDestination(persona: Persona, input: PersonaResolverInput): string {
    const projectHome = input.firstProjectSlug
      ? `/${input.firstProjectSlug}`
      : input.hasGovernanceUi
        ? "/me"
        : "/onboarding/welcome";

    if (!input.hasGovernanceUi) return projectHome;
    switch (persona) {
      case "governance_admin":
        return "/governance";
      case "personal_only":
      case "mixed":
        return "/me";
      case "project_only":
        return projectHome;
    }
  }
}
