import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The part of the sign-up ceremony that belongs to another feature: the first
 * project, created through the SAME project service every other door uses.
 */
export interface OrganizationCeremony {
  // Properties of function type rather than method shorthand: a test holds a
  // mock built to this interface and asserts on these members via
  // `expect(...).toHaveBeenCalledWith`/`.not.toHaveBeenCalled()`, which is
  // unsafe against a method-shorthand member under `unbound-method`.
  createProject: (
    input: Readonly<{
      organizationId: string;
      teamId: string;
      name: string;
      language: string;
      framework: string;
      userId: string;
    }>,
  ) => Promise<Readonly<{ success: boolean; projectSlug: string }>>;
}

/**
 * The parts of the sign-up ceremony belonging to other features. The first
 * project goes through the project application rather than a second creation
 * path, so it writes the same rows the project surface writes.
 */
export class OrganizationCeremonyService {
  private constructor() {}

  static create(options: { projects: ProjectApi }): OrganizationCeremony {
    return {
      createProject: async (input) => {
        const project = await options.projects.create(
          {
            organizationId: input.organizationId,
            teamId: input.teamId,
            name: input.name,
            language: input.language,
            framework: input.framework,
          },
          { id: input.userId },
        );

        return { success: true, projectSlug: project.slug };
      },
    };
  }
}
