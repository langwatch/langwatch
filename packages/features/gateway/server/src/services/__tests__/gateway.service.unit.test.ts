import {
  GatewayBudgetRepository,
  type GatewayBudgetCheckReadInput,
} from "../../repositories/gateway-budget.repository";
import { GatewayCacheRuleRepository } from "../../repositories/gateway-cache-rule.repository";
import { GatewayGuardrailRepository } from "../../repositories/gateway-guardrail.repository";
import { GatewayCacheRulePersistence } from "../gateway-cache-rule.service";
import { GatewayGuardrailCatalogue } from "../gateway-guardrail.service";
import { GatewayService } from "../gateway.service";
import { TestProjectService } from "./support/test-project-service";
import type { GatewayBudgetCheckResult } from "@langwatch/gateway-contract";
import { EvaluatorService } from "@langwatch/evaluator-contract";
import { MonitorService } from "@langwatch/monitor-contract";
import { describe, expect, it } from "vitest";
import { GatewayAuditPort } from "../../ports/gateway-audit.port";

class FakeBudgetRepository extends GatewayBudgetRepository {
  input: GatewayBudgetCheckReadInput | null = null;

  constructor(private readonly result: GatewayBudgetCheckResult) {
    super();
  }

  findAttributedUserTemplates(): Promise<never[]> {
    return Promise.resolve([]);
  }

  findBucketBoundaries(): Promise<never[]> {
    return Promise.resolve([]);
  }

  check(input: GatewayBudgetCheckReadInput): Promise<GatewayBudgetCheckResult> {
    this.input = input;
    return Promise.resolve(this.result);
  }

  list(): never {
    throw new Error("not used");
  }
  listForProject(): never {
    throw new Error("not used");
  }
  listWithHealth(): never {
    throw new Error("not used");
  }
  listPageWithHealth(): never {
    throw new Error("not used");
  }
  listForProjectWithHealth(): never {
    throw new Error("not used");
  }
  tryGet(): never {
    throw new Error("not used");
  }
  tryGetWithHealth(): never {
    throw new Error("not used");
  }
  tryGetDetail(): never {
    throw new Error("not used");
  }
  listScopeReachCandidates(): never {
    throw new Error("not used");
  }
  create(): never {
    throw new Error("not used");
  }
  update(): never {
    throw new Error("not used");
  }
  archive(): never {
    throw new Error("not used");
  }
  reset(): never {
    throw new Error("not used");
  }
  resolveApplicableBudgets(): never {
    throw new Error("not used");
  }
  resolveScopeTargets(): never {
    throw new Error("not used");
  }
  listVirtualKeyProjectScopes(): never {
    throw new Error("not used");
  }
}

class EmptyCacheRuleRepository extends GatewayCacheRuleRepository {
  list(): never {
    throw new Error("not used");
  }
  listPage(): never {
    throw new Error("not used");
  }
  tryGet(): never {
    throw new Error("not used");
  }
  create(): never {
    throw new Error("not used");
  }
  update(): never {
    throw new Error("not used");
  }
  archive(): never {
    throw new Error("not used");
  }
  listEnabledForOrganization(): never {
    throw new Error("not used");
  }
}

class EmptyGuardrailRepository extends GatewayGuardrailRepository {
  list(): never {
    throw new Error("not used");
  }
  listBundleEntries(): never {
    throw new Error("not used");
  }
  tryGet(): never {
    throw new Error("not used");
  }
  create(): never {
    throw new Error("not used");
  }
  update(): never {
    throw new Error("not used");
  }
  archive(): never {
    throw new Error("not used");
  }
}

class UnusedEvaluatorService extends EvaluatorService {
  executeCode(): never {
    throw new Error("not used");
  }
  executeNative(): never {
    throw new Error("not used");
  }
  augmentResult(): never {
    throw new Error("not used");
  }
  tryGetById(): never {
    throw new Error("not used");
  }
  getById(): never {
    throw new Error("not used");
  }
  tryGetByIdWithFields(): never {
    throw new Error("not used");
  }
  getByIdWithFields(): never {
    throw new Error("not used");
  }
  resolveForExecution(): never {
    throw new Error("not used");
  }
  tryGetBySlug(): never {
    throw new Error("not used");
  }
  tryGetByWorkflow(): never {
    throw new Error("not used");
  }
  getBySlug(): never {
    throw new Error("not used");
  }
  getAll(): never {
    throw new Error("not used");
  }
  getAllWithFields(): never {
    throw new Error("not used");
  }
  create(): never {
    throw new Error("not used");
  }
  createWithDefaults(): never {
    throw new Error("not used");
  }
  update(): never {
    throw new Error("not used");
  }
  archive(): never {
    throw new Error("not used");
  }
  getWorkflowFields(): never {
    throw new Error("not used");
  }
  getCopies(): never {
    throw new Error("not used");
  }
  pushToCopies(): never {
    throw new Error("not used");
  }
  syncFromSource(): never {
    throw new Error("not used");
  }
  getCopySource(): never {
    throw new Error("not used");
  }
  getHistory(): never {
    throw new Error("not used");
  }
}

class UnusedMonitorService extends MonitorService {
  getAllForProject(): never {
    throw new Error("not used");
  }
  getEnabledOnMessageMonitors(): never {
    throw new Error("not used");
  }
  listEnabledGuardrailMonitors(): never {
    throw new Error("not used");
  }
  getById(): never {
    throw new Error("not used");
  }
  tryGetMonitorById(): never {
    throw new Error("not used");
  }
  getAllByIds(): never {
    throw new Error("not used");
  }
  toggle(): never {
    throw new Error("not used");
  }
  create(): never {
    throw new Error("not used");
  }
  update(): never {
    throw new Error("not used");
  }
  delete(): never {
    throw new Error("not used");
  }
  deleteForExperiment(): never {
    throw new Error("not used");
  }
  upsertForExperiment(): never {
    throw new Error("not used");
  }
  isNameAvailable(): never {
    throw new Error("not used");
  }
  replicate(): never {
    throw new Error("not used");
  }
}

class NullGatewayAuditPort extends GatewayAuditPort {
  append(): Promise<void> {
    return Promise.resolve();
  }
}

function serviceFor(result: GatewayBudgetCheckResult): {
  service: GatewayService;
  repository: FakeBudgetRepository;
} {
  const repository = new FakeBudgetRepository(result);
  const projects = new TestProjectService();
  return {
    service: GatewayService.create({
      repository,
      projects,
      cacheRules: GatewayCacheRulePersistence.create(new EmptyCacheRuleRepository()),
      guardrails: GatewayGuardrailCatalogue.create({
        repository: new EmptyGuardrailRepository(),
        evaluators: new UnusedEvaluatorService(),
        monitors: new UnusedMonitorService(),
        projects,
        audit: new NullGatewayAuditPort(),
      }),
    }),
    repository,
  };
}

/** A service whose cache-rule and guardrail catalogues actually answer. */
function serviceOverCatalogues({
  cacheRules,
  guardrails,
}: {
  cacheRules: unknown[];
  guardrails: Array<{ id: string }>;
}): GatewayService {
  const projects = new TestProjectService();
  const cacheRuleRepository = new EmptyCacheRuleRepository();
  const guardrailRepository = new EmptyGuardrailRepository();
  cacheRuleRepository.listEnabledForOrganization = (async () => cacheRules) as never;
  guardrailRepository.listBundleEntries = (async () => guardrails) as never;

  return GatewayService.create({
    repository: new FakeBudgetRepository({
      decision: "allow",
      warnings: [],
      blockReason: null,
      blockedBy: [],
      scopes: [],
    }),
    projects,
    cacheRules: GatewayCacheRulePersistence.create(cacheRuleRepository),
    guardrails: GatewayGuardrailCatalogue.create({
      repository: guardrailRepository,
      evaluators: new UnusedEvaluatorService(),
      monitors: new UnusedMonitorService(),
      projects,
      audit: new NullGatewayAuditPort(),
    }),
  });
}

describe("GatewayService configuration bundle", () => {
  describe("given an organization with enabled rules and a virtual key on a trace project", () => {
    describe("when the Gateway materialises its configuration bundle", () => {
      /** @scenario "A configuration bundle includes only eligible persistence records" */
      it("takes the enabled rules the catalogue answers with and drops attachments the project has not got", async () => {
        const service = serviceOverCatalogues({
          cacheRules: [{ id: "rule_enabled" }],
          guardrails: [{ id: "guardrail_present" }],
        });

        const bundle = await service.loadConfigurationPersistence({
          organizationId: "org_1",
          traceProjectId: "project_1",
          guardrailAttachments: [
            { direction: "input", guardrailIds: ["guardrail_present", "guardrail_absent"] },
            { direction: "output", guardrailIds: ["guardrail_absent"] },
          ],
        });

        expect(bundle.cacheRules).toEqual([{ id: "rule_enabled" }]);
        expect(bundle.guardrails).toEqual([{ id: "guardrail_present" }]);
        // The output attachment named only a guardrail this project's
        // catalogue does not hold, so it leaves the bundle entirely rather
        // than travelling as an empty direction the gateway would enforce.
        expect(bundle.attachments).toEqual([
          { direction: "input", guardrailIds: ["guardrail_present"] },
        ]);
      });

      /** @scenario "A configuration bundle includes only eligible persistence records" */
      it("asks no project catalogue and attaches no guardrail when the key targets no trace project", async () => {
        const service = serviceOverCatalogues({
          cacheRules: [{ id: "rule_enabled" }],
          guardrails: [{ id: "guardrail_present" }],
        });

        const bundle = await service.loadConfigurationPersistence({
          organizationId: "org_1",
          traceProjectId: null,
          guardrailAttachments: [{ direction: "input", guardrailIds: ["guardrail_present"] }],
        });

        expect(bundle.cacheRules).toEqual([{ id: "rule_enabled" }]);
        expect(bundle.guardrails).toEqual([]);
        expect(bundle.attachments).toEqual([]);
      });
    });
  });
});

describe("GatewayService budget decisions", () => {
  it("forwards the canonical budget check with Project-owned tenant ids", async () => {
    const { service, repository } = serviceFor({
      decision: "hard_block",
      warnings: [],
      blockReason: "Budget exceeded for scope=organization window=month",
      blockedBy: [],
      scopes: [],
    });

    await expect(
      service.checkBudget({
        organizationId: "org_1",
        teamId: null,
        projectId: null,
        virtualKeyId: "vk_1",
        projectedCostUsd: "0.50",
      }),
    ).resolves.toMatchObject({ decision: "hard_block" });

    expect(repository.input).toMatchObject({ organizationId: "org_1", tenantIds: [] });
  });

  it("does not rewrite provider-filtered budget decisions from the repository", async () => {
    const { service } = serviceFor({
      decision: "soft_warn",
      warnings: [{ scope: "organization", pctUsed: 90, limitUsd: "1" }],
      blockReason: null,
      blockedBy: [],
      scopes: [
        {
          scope: "organization",
          scopeId: "org_1",
          window: "month",
          spentUsd: "0.9",
          limitUsd: "1",
        },
      ],
    });

    await expect(
      service.checkBudget({
        organizationId: "org_1",
        teamId: null,
        projectId: null,
        virtualKeyId: "vk_1",
        projectedCostUsd: "0.01",
        providerKey: "provider_anthropic",
      }),
    ).resolves.toMatchObject({ decision: "soft_warn", blockedBy: [] });
  });
});
