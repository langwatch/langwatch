import type { PublishedWorkflowAnswer } from "@langwatch/workflow-contract";

import type { WorkflowPublicationReads } from "../app/workflow.app.ts";

/** A workflow's publication: the version it offers the Optimization Studio, and its flags. */
export class WorkflowPublicationService {
  static create(options: { publications: WorkflowPublicationReads }): WorkflowPublicationService {
    return new WorkflowPublicationService(options);
  }

  readonly #publications: WorkflowPublicationReads;

  private constructor(options: { publications: WorkflowPublicationReads }) {
    this.#publications = options.publications;
  }

  async getPublished(input: {
    workflowId: string;
    projectId: string;
  }): Promise<PublishedWorkflowAnswer> {
    const workflow = await this.#publications.findFlags(input);
    const publishedWorkflow = await this.#publications.findVersion({
      versionId: workflow?.publishedId ?? "",
      projectId: input.projectId,
    });

    if (!publishedWorkflow) return { published: false };

    return {
      published: true,
      workflow: {
        ...publishedWorkflow,
        isComponent: workflow?.isComponent,
        isEvaluator: workflow?.isEvaluator,
      },
    };
  }
}
