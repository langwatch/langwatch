import { SuiteNotFoundError, type RunPlanWire, type Suite } from "@langwatch/suite-contract";

import type { SuiteRepository } from "../repositories/suite.repository.ts";
import { toRunPlanWire } from "../rules/suite-wire-v1.rules.ts";
import type { SuitePlatformLinkService } from "./suite-platform-link.service.ts";

/** The run plans as `/api/v1/run-plans` publishes them: main's handler, moved one-to-one. */
export class RunPlanReadService {
  static create(input: {
    repository: SuiteRepository;
    links: SuitePlatformLinkService;
  }): RunPlanReadService {
    return new RunPlanReadService(input.repository, input.links);
  }

  private constructor(
    private readonly repository: SuiteRepository,
    private readonly links: SuitePlatformLinkService,
  ) {}

  async list(input: {
    projectId: string;
    projectSlug: string;
    includeArchived?: boolean;
  }): Promise<RunPlanWire[]> {
    const suites = await this.repository.findAll({
      projectId: input.projectId,
      includeArchived: input.includeArchived,
    });

    return Promise.all(suites.map((suite) => this.wire({ ...input, suite })));
  }

  /** A test suite id reads as a missing run plan: the two families address disjoint rows. */
  async get(input: { projectId: string; projectSlug: string; id: string }): Promise<RunPlanWire> {
    const suite = await this.repository.findById({ id: input.id, projectId: input.projectId });
    if (suite?.kind !== "run_plan") throw new SuiteNotFoundError("Run plan not found");

    return this.wire({ ...input, suite });
  }

  private async wire(input: {
    projectId: string;
    projectSlug: string;
    suite: Suite;
  }): Promise<RunPlanWire> {
    const [evaluators, platformUrl] = await Promise.all([
      this.repository.findPlanEvaluators({ id: input.suite.id, projectId: input.projectId }),
      this.links.suiteUrl({
        projectId: input.projectId,
        projectSlug: input.projectSlug,
        slug: input.suite.slug,
        kind: "run_plan",
      }),
    ]);

    return toRunPlanWire({ suite: input.suite, evaluators, platformUrl });
  }
}
