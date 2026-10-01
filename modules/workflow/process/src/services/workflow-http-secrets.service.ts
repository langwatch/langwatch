import { createSecretReferencer } from "@langwatch/agent-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { dslStoringHttpSecrets } from "@langwatch/workflow-contract";

import type { WorkflowHttpSecrets } from "../app/workflow.app.ts";

type HttpSecretWriter = Pick<SecretApi, "getValues" | "create">;

/** Stores the token typed into an HTTP node as a project secret, leaving its reference. */
export class WorkflowHttpSecretsService implements WorkflowHttpSecrets {
  static create(secrets: HttpSecretWriter): WorkflowHttpSecretsService {
    return new WorkflowHttpSecretsService(secrets);
  }

  private constructor(private readonly secrets: HttpSecretWriter) {}

  store<Dsl extends { nodes?: unknown }>(input: {
    projectId: string;
    dsl: Dsl;
    authorId: string | undefined;
  }): Promise<Dsl> {
    const { projectId, authorId } = input;

    return dslStoringHttpSecrets({
      dsl: input.dsl,
      reference: createSecretReferencer({
        values: () => this.secrets.getValues({ projectId }),
        create: async ({ name, value }) => {
          await this.secrets.create(
            { projectId, name, value },
            authorId ? { id: authorId } : undefined,
          );
        },
      }),
    });
  }
}
