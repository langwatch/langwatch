import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  AGENT_TESTING_FLAG,
  batchRunPath,
  scenarioEditorPath,
  scenarioRunPath,
  scenarioSetPath,
  type TestingInterface,
} from "@langwatch/suite-contract";

import { scenarioPlatformUrl } from "../rules/scenario-platform-url.rules.ts";

/** The platform's own links, in the interface the project reads (main's `platform-path.ts`). */
export class ScenarioPlatformLinkService {
  static create(input: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    publicBaseUrl: string | undefined;
  }): ScenarioPlatformLinkService {
    return new ScenarioPlatformLinkService(input);
  }

  readonly #featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  readonly #projects: Pick<ProjectApi, "getOrganizationId">;
  readonly #publicBaseUrl: string | undefined;
  /** A project never changes organization, so the answer is kept for the process's life. */
  readonly #organizationIds = new Map<string, Promise<string>>();
  /** One flag read per project in flight, so a listed page reads it once. */
  readonly #interfaceReads = new Map<string, Promise<TestingInterface>>();

  private constructor(input: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    publicBaseUrl: string | undefined;
  }) {
    this.#featureFlags = input.featureFlags;
    this.#projects = input.projects;
    this.#publicBaseUrl = input.publicBaseUrl;
  }

  async resourceUrl(input: {
    projectId: string;
    projectSlug: string;
    resource: { scenarioId: string } | { scenarioRunId: string };
  }): Promise<string> {
    const ui = await this.#readInterface(input.projectId);
    const path =
      "scenarioRunId" in input.resource
        ? scenarioRunPath({ ui, scenarioRunId: input.resource.scenarioRunId })
        : scenarioEditorPath({ ui, scenarioId: input.resource.scenarioId });

    return this.#url({ projectSlug: input.projectSlug, path });
  }

  async scenarioSetUrl(input: {
    projectId: string;
    projectSlug: string;
    scenarioSetId: string;
  }): Promise<string> {
    const ui = await this.#readInterface(input.projectId);

    return this.#url({
      projectSlug: input.projectSlug,
      path: scenarioSetPath({ ui, scenarioSetId: input.scenarioSetId }),
    });
  }

  async batchRunUrl(input: {
    projectId: string;
    projectSlug: string;
    scenarioSetId: string;
    batchRunId: string;
  }): Promise<string> {
    const ui = await this.#readInterface(input.projectId);

    return this.#url({
      projectSlug: input.projectSlug,
      path: batchRunPath({ ui, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId }),
    });
  }

  #url(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The scenario REST families were asked for a platform link, but this deployment named no public base URL",
      );
    }

    return scenarioPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }

  #readInterface(projectId: string): Promise<TestingInterface> {
    const inFlight = this.#interfaceReads.get(projectId);
    if (inFlight) return inFlight;

    const read = this.#resolveInterface(projectId).finally(() =>
      this.#interfaceReads.delete(projectId),
    );
    this.#interfaceReads.set(projectId, read);
    return read;
  }

  /** A flag read that fails answers Simulations: the interface every project can open. */
  async #resolveInterface(projectId: string): Promise<TestingInterface> {
    try {
      const organizationId = await this.#organizationIdOf(projectId);
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

  #organizationIdOf(projectId: string): Promise<string> {
    const known = this.#organizationIds.get(projectId);
    if (known) return known;

    const read = this.#projects.getOrganizationId(projectId);
    read.catch(() => this.#organizationIds.delete(projectId));
    this.#organizationIds.set(projectId, read);
    return read;
  }
}
