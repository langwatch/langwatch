import { createSecretReferencer } from "@langwatch/agent-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { dslStoringHttpSecrets } from "@langwatch/workflow-contract";

import type { WorkflowHttpSecrets } from "../app/workflow.app.ts";

type HttpSecretWriter = Pick<SecretApi, "getValues" | "list" | "create">;

/** Stores the token typed into an HTTP node as a project secret bound to the node's origin,
 * leaving its reference. */
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
        origins: async () => {
          const origins: Record<string, string> = {};
          for (const { name, boundOrigin } of await this.secrets.list({ projectId })) {
            if (boundOrigin) origins[name] = boundOrigin;
          }

          return origins;
        },
        create: async ({ name, value, boundOrigin }) => {
          await this.secrets.create(
            { projectId, name, value, boundOrigin },
            authorId ? { id: authorId } : undefined,
          );
        },
      }),
    });
  }
}
