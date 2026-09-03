import type { AgentService } from "@langwatch/agent-contract";
import { PostgresAgentAdapter, type LinkedWorkflowCopyPort } from "@langwatch/agent-server";
import type { PrismaConnection } from "@langwatch/prisma-client";

/** Reports the composition decisions a missing collaborator would otherwise hide. */
export abstract class ApiAgentsAbsenceReportPort {
  abstract absent(reason: "no-database"): void;
  /**
   * Names the one capability the composed service does NOT have, which is a
   * different fact from having no service at all and is worth its own line.
   */
  abstract withoutWorkflowCopies(): void;
}

export type ApiAgentsCompositionOptions = {
  database: PrismaConnection;
  /** Names this process in the refusal a missing workflow copy produces. */
  processName: string;
  /**
   * The Workflow application's copy, for a process that composes one.
   *
   * This process does not, and the parameter is here so that saying so is a
   * decision at the composition root rather than a fact buried in the package.
   */
  workflowCopies?: LinkedWorkflowCopyPort;
};

/**
 * The API process's own agent service, composed rather than received.
 *
 * Everything below the contract service is the feature package's:
 * `PostgresAgentAdapter` builds the agent repository, the linked-workflow
 * reads and the audit-history read from ONE guarded Prisma client. What kept
 * this process from calling it was never the database — it was that
 * `AgentsWorkflowPort` and `AgentsAuditLogPort` had exactly one implementation
 * anywhere, and it was the legacy application's.
 *
 * They have a packaged one now, and almost all of it was always Postgres: the
 * fields a linked graph declares, the workflow's name, archiving it, deleting
 * it after a failed copy, and the `agents.` audit entries that are an agent's
 * history. None of that needed the application.
 *
 * ONE capability did, and it is named rather than hidden. Copying a WORKFLOW
 * agent copies the Studio graph it points at, which is the Workflow
 * lifecycle's own `copy` — its dataset copier, its DSL rewrite, its version
 * parentage — and this process composes no Workflow application to reach it.
 * So it composes no workflow-copy port, and the service it builds refuses that
 * one operation by name. The alternative was writing an agent in the target
 * project that points at the SOURCE project's graph, which every caller would
 * read as a copy that succeeded.
 */
export class ApiAgentsComposition {
  /**
   * Composes the agent service only when this process holds the one thing it
   * reads through.
   *
   * With no client there is no service, and the agents door is absent rather
   * than mounted — the same rule the secret family follows. A router whose
   * every procedure answers with a 500 is worse than one that is not there.
   */
  static tryCompose(
    options: Omit<ApiAgentsCompositionOptions, "database"> & {
      database: PrismaConnection | undefined;
      report?: ApiAgentsAbsenceReportPort;
    },
  ): ApiAgentsComposition | undefined {
    if (!options.database) {
      options.report?.absent("no-database");
      return undefined;
    }
    if (!options.workflowCopies) options.report?.withoutWorkflowCopies();
    return ApiAgentsComposition.compose({ ...options, database: options.database });
  }

  static compose(options: ApiAgentsCompositionOptions): ApiAgentsComposition {
    return new ApiAgentsComposition(
      PostgresAgentAdapter.create({
        // The typed client satisfies the feature's structural database port on
        // its own terms, and the two repositories underneath take the same
        // typed client. No assertion sits at this seam, and none should.
        database: options.database.client,
        ...(options.workflowCopies ? { workflowCopies: options.workflowCopies } : {}),
        processName: options.processName,
      }).build(),
    );
  }

  private constructor(readonly agents: AgentService) {}
}
