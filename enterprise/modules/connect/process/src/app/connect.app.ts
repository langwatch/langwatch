import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  ConnectApi,
  type ConnectApi as ConnectApiContract,
  type HostedCapAnswer,
  type HostedClassifyAnswer,
} from "@langwatch/enterprise-connect-contract";
import {
  LicensingApi,
  type HostedCaller,
  type HostedUsageAnswer,
} from "@langwatch/enterprise-licensing-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";

import { ConnectSpendBufferService } from "../services/connect-spend-buffer.service.ts";
import { ContractBudgetStoreService } from "../services/contract-budget-store.service.ts";
import { ContractBudgetService } from "../services/contract-budget.service.ts";
import { HostedServicesService } from "../services/hosted-services.service.ts";
import { HostedUsageReaderService } from "../services/hosted-usage-reader.service.ts";

const logger = createLogger("langwatch:connect");

type ConnectSetup = FeatureSetup<typeof ConnectModule.dependencies, undefined>;

/**
 * The hosted end of Connect (ADR-156 §5), composed from its owners on every deployment:
 * licensing answers which licence a key runs under and its terms, instant-eval judges,
 * prices and records the spend, the gateway keeps the budgets and the door.
 */
export class ConnectModule implements ConnectApiContract {
  static readonly contract: typeof ConnectApi = ConnectApi;
  static readonly dependencies = {
    /** The budgets a hosted caller reads and moves, and the door its calls arrive through. */
    gateway: GatewayApi,
    /** The judge a hosted classify call reaches, its price, and where its spend is recorded. */
    instantEval: InstantEvalApi,
    /** Whose team a hosted caller's project belongs to, for the budgets that apply to it. */
    scopes: AuthzApi,
    /** The active licence behind a managed key, and the customer's contract terms. */
    licensing: LicensingApi,
  };

  readonly #hosted: HostedServicesService;
  readonly #spend: ConnectSpendBufferService;

  private constructor({
    hosted,
    spend,
  }: {
    hosted: HostedServicesService;
    spend: ConnectSpendBufferService;
  }) {
    this.#hosted = hosted;
    this.#spend = spend;
  }

  static async create({ dependencies, resources }: ConnectSetup): Promise<ConnectModule> {
    const { gateway, instantEval, scopes, licensing } = dependencies;
    const spend = ConnectSpendBufferService.create({
      recorder: { recordSpend: (entry) => instantEval.recordSpendForHostedCalls(entry) },
      logger,
    });
    const app = new ConnectModule({
      spend,
      hosted: HostedServicesService.create({
        licenses: licensing,
        judge: {
          classify: (input, signal) =>
            instantEval.classify({ ...input, ...(signal ? { signal } : {}) }),
          priceOf: (input) => instantEval.priceOf(input),
        },
        spend,
        usage: HostedUsageReaderService.create({ gateway, scopes }),
        contractBudgets: ContractBudgetService.create({
          store: ContractBudgetStoreService.create({ gateway }),
          terms: licensing,
          systemActorId: SYSTEM_ACTORS.connectLicense,
        }),
      }),
    });
    // Hosted spend a gateway reported but the buffer has not written yet is written at shutdown.
    resources.own("hosted-service spend buffer", () => app.flushHostedSpend());
    return app;
  }

  classifyForHostedCaller(input: {
    caller: HostedCaller;
    payload: unknown;
    signal?: AbortSignal;
  }): Promise<HostedClassifyAnswer> {
    return this.#hosted.classify(input);
  }

  getHostedUsage(input: { caller: HostedCaller }): Promise<HostedUsageAnswer> {
    return this.#hosted.usage(input);
  }

  setHostedBudgetCap(input: { caller: HostedCaller; payload: unknown }): Promise<HostedCapAnswer> {
    return this.#hosted.setBudget(input);
  }

  /** Writes hosted spend the buffer still holds. Called by the drain. */
  flushHostedSpend(): Promise<void> {
    return this.#spend.flush();
  }
}
