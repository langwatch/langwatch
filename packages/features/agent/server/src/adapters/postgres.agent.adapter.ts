import type { AgentService as AgentServiceContract } from "@langwatch/agent-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AgentsWorkflowPort } from "../ports/agent.port";
import type { LinkedWorkflowCopyPort } from "../ports/linked-workflow-copy.port";
import { PrismaAgentHistoryRepository } from "../repositories/prisma/prisma.agent-history.repository";
import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository";
import { PrismaLinkedWorkflowRepository } from "../repositories/prisma/prisma.linked-workflow.repository";
import { AgentService } from "../services/agent.service";
import { UnavailableLinkedWorkflowCopyAdapter } from "./unavailable.linked-workflow-copy.adapter";

export type PostgresAgentAdapterOptions = {
  /**
   * The composition root's own guarded client, typed.
   *
   * Everything the agent service reads lives behind it: the agent rows, the
   * workflow a workflow agent points at, and the audit entries that are its
   * history. Nothing below this file constructs a client and nothing casts one.
   */
  database: PrismaClient;
  /**
   * The Workflow application's copy, when this process composes one.
   *
   * Optional because absence is a supported shape rather than a gap this
   * adapter is papering over: a process that holds no Workflow application
   * serves every other agent operation and refuses this one by name
   * ({@link UnavailableLinkedWorkflowCopyAdapter}).
   */
  workflowCopies?: LinkedWorkflowCopyPort;
  /** Names the process in the refusal above; only read when there is one. */
  processName?: string;
  generateId?: () => string;
};

/**
 * Binds the feature's private Prisma repositories to one process-owned agent
 * service.
 *
 * The seam `PrismaAgentAdapter` offers takes the two collaborators already
 * built; this one takes the CLIENT and builds them, which is what lets a
 * process that holds nothing but a guarded connection compose the service
 * rather than receive it. The two ports it fills —
 * `AgentsWorkflowPort` and `AgentsAuditLogPort` — were the entry on
 * `API_UNAVAILABLE_PRODUCT_ADAPTERS`, and neither of them ever needed anything
 * the legacy application owned except the single copy operation the
 * workflow-copy port now names.
 */
export class PostgresAgentAdapter {
  static create(options: PostgresAgentAdapterOptions): PostgresAgentAdapter {
    return new PostgresAgentAdapter(options);
  }

  private service: AgentServiceContract | undefined;
  private repository: PrismaAgentRepository | undefined;

  private constructor(private readonly options: PostgresAgentAdapterOptions) {}

  build(): AgentServiceContract {
    this.service ??= AgentService.create({
      repository: this.repo(),
      workflows: this.linkedWorkflows(),
      auditLog: PrismaAgentHistoryRepository.create(this.options.database),
      generateId: this.options.generateId,
    });
    return this.service;
  }

  /**
   * The one write ADR-128's presence projection needs, over the SAME
   * repository {@link build} uses — narrow so a process outside this package
   * (the connected-agent session core's composition root) can satisfy it
   * without the private `AgentRepository` type.
   */
  presenceWriter(): { touchLastSeenAt: PrismaAgentRepository["touchLastSeenAt"] } {
    const repository = this.repo();
    return { touchLastSeenAt: (input) => repository.touchLastSeenAt(input) };
  }

  private repo(): PrismaAgentRepository {
    this.repository ??= PrismaAgentRepository.create(this.options.database);
    return this.repository;
  }

  /**
   * The linked-workflow capability, assembled from the row reads this package
   * owns and the copy it does not.
   *
   * One port with two sources because that is the truth about it: four
   * operations are one table, and the fifth is another feature's lifecycle.
   * Splitting the port instead would push that distinction onto
   * `AgentService`, which has no reason to know which of its collaborator's
   * methods reach further than the others.
   */
  private linkedWorkflows(): AgentsWorkflowPort {
    const rows = PrismaLinkedWorkflowRepository.create(this.options.database);
    const copies =
      this.options.workflowCopies ??
      UnavailableLinkedWorkflowCopyAdapter.create({
        processName: this.options.processName ?? "This process",
      });
    return {
      fields: (input) => rows.fields(input),
      related: (input) => rows.related(input),
      archive: (input) => rows.archive(input),
      remove: (input) => rows.remove(input),
      copy: (input) => copies.copy(input),
    };
  }
}
