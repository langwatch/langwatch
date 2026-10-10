import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  AGENT_TESTING_FLAG,
  suitePath,
  type SuiteKind,
  type TestingInterface,
} from "@langwatch/suite-contract";

import { suitePlatformUrl } from "../rules/suite-platform-url.rules.ts";

/**
 * A suite's platform address in the interface the project reads (main's `suitePlatformPath`),
 * the same flag read `ScenarioPlatformLinkService` makes for scenario links.
 */
export class SuitePlatformLinkService {
  static create(input: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    publicBaseUrl: string | undefined;
  }): SuitePlatformLinkService {
    return new SuitePlatformLinkService(input);
  }

  readonly #featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  readonly #projects: Pick<ProjectApi, "getOrganizationId">;
  readonly #publicBaseUrl: string | undefined;

  private constructor(input: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    publicBaseUrl: string | undefined;
  }) {
    this.#featureFlags = input.featureFlags;
    this.#projects = input.projects;
    this.#publicBaseUrl = input.publicBaseUrl;
  }

  async suiteUrl(input: {
    projectId: string;
    projectSlug: string;
    slug: string;
    kind: SuiteKind;
  }): Promise<string> {
    const ui = await this.#readInterface(input.projectId);
    const path = suitePath({ ui, slug: input.slug, kind: input.kind });

    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The suite REST families were asked for a platform link, but this deployment named no public base URL",
      );
    }

    return suitePlatformUrl({
      publicBaseUrl: this.#publicBaseUrl,
      projectSlug: input.projectSlug,
      path,
    });
  }

  /** A flag read that fails answers Simulations: the interface every project can open. */
  async #readInterface(projectId: string): Promise<TestingInterface> {
    try {
      const organizationId = await this.#projects.getOrganizationId(projectId);
      const enabled = await this.#featureFlags.isEnabled(AGENT_TESTING_FLAG, {
        kind: "project",
        projectId,
        organizationId,
      });
      return enabled ? "agent_testing" : "simulations";
    } catch {
      return "simulations";
    }
  }
}
