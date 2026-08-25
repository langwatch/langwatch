import type { AutomationService } from "@langwatch/automation-contract";
import {
  AutomationClock,
  PostgresAutomationAdapter,
  SchedulerWake,
  UnsubscribeTokenVerifier,
} from "@langwatch/automation-server";
import { createAutomationTestRuntime } from "@langwatch/automation-server/testing";
import type { Cluster, Redis } from "ioredis";
import type { PrismaClient } from "~/generated/prisma/client";
import { SchedulerService } from "~/server/app-layer/scheduler/scheduler.service";
import { PrismaScheduledJobStore } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { verifyUnsubscribeToken } from "~/server/mailer/unsubscribeToken";
import type { AppAutomationGraphPorts } from "./automation-graph-ports";

type SchedulerRedis = Redis | Cluster | null | undefined;

export class AppAutomationClock extends AutomationClock {
  now(): Date {
    return new Date();
  }
}

class AppUnsubscribeTokenVerifier extends UnsubscribeTokenVerifier {
  tryVerify(token: string) {
    return verifyUnsubscribeToken(token);
  }
}

class AppSchedulerWake extends SchedulerWake {
  constructor(private readonly redis: SchedulerRedis) {
    super();
  }

  publish(): void {
    SchedulerService.publishWake(this.redis);
  }
}

/** Process-owned composition root for triggers, schedules and suppressions. */
export class AppAutomationRuntime {
  private constructor(
    private readonly database: PrismaClient,
    private readonly redis: SchedulerRedis,
    private readonly graph: AppAutomationGraphPorts,
    private readonly clock: AutomationClock,
  ) {}

  static create(options: {
    database: PrismaClient;
    redis?: SchedulerRedis;
    graph: AppAutomationGraphPorts;
    clock?: AutomationClock;
  }): AppAutomationRuntime {
    return new AppAutomationRuntime(
      options.database,
      options.redis,
      options.graph,
      options.clock ?? new AppAutomationClock(),
    );
  }

  build(): AutomationService {
    const jobs = new PrismaScheduledJobStore(this.database);

    return PostgresAutomationAdapter.create({
      database: this.database,
      jobs,
      clock: this.clock,
      verifier: new AppUnsubscribeTokenVerifier(),
      wake: new AppSchedulerWake(this.redis),
      ...this.graph,
    }).build();
  }
}

export function createAppAutomationTestGraphPorts(): AppAutomationGraphPorts {
  return createAutomationTestRuntime();
}
