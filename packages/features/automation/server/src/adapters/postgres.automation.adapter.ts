import { AutomationService } from "../services/automation.service";
import type { AutomationService as AutomationCapability } from "@langwatch/automation-contract";
import type { UnsubscribeTokenVerifier } from "../ports/unsubscribe-token.port";
import type { AutomationClock } from "../ports/automation-clock.port";
import type { ScheduledJobStore } from "../ports/scheduled-jobs.port";
import type { SchedulerWake } from "../ports/scheduler-wake.port";
import { PrismaEmailSuppressionNameRepository } from "../repositories/prisma/prisma.email-suppression-name.repository";
import { PrismaEmailSuppressionRepository } from "../repositories/prisma/prisma.email-suppression.repository";
import { PrismaTriggerFireHistoryRepository } from "../repositories/prisma/prisma.trigger-fire-history.repository";
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository";
import { ReportScheduleService } from "../services/report-schedule.service";
import { PrismaAutomationDatabaseRepository } from "../repositories/prisma/prisma.automation.repository";
import { PrismaCustomGraphRepository } from "../repositories/prisma/prisma.custom-graph.repository";
import { PrismaWebhookDeliveryRepository } from "../repositories/prisma/prisma.webhook-delivery.repository";

/** Canonical process binding. The app supplies its already-created database
 * capability; this adapter never reaches for a global Prisma client. */
export class PostgresAutomationAdapter {
	private constructor(
		private readonly input: {
			database: object;
			verifier: UnsubscribeTokenVerifier;
			jobs: ScheduledJobStore;
			clock: AutomationClock;
			wake: SchedulerWake;
		},
	) {}

	static create(input: {
		database: object;
		verifier: UnsubscribeTokenVerifier;
		jobs: ScheduledJobStore;
		clock: AutomationClock;
		wake: SchedulerWake;
	}): PostgresAutomationAdapter {
		return new PostgresAutomationAdapter(input);
	}

	build(): AutomationCapability {
		const { verifier } = this.input;
		const database = PrismaAutomationDatabaseRepository.create(
			this.input.database,
		).build();
		const triggerRepository = PrismaTriggerRepository.create(
			database,
			this.input.clock,
		);
		const history = PrismaTriggerFireHistoryRepository.create(database);
		return AutomationService.create({
			triggers: triggerRepository,
			history,
			suppressions: PrismaEmailSuppressionRepository.create(database),
			names: PrismaEmailSuppressionNameRepository.create(database),
			verifier,
			reportSchedules: ReportScheduleService.create({
				jobs: this.input.jobs,
				clock: this.input.clock,
				wake: this.input.wake,
			}),
			clock: this.input.clock,
			customGraphs: PrismaCustomGraphRepository.create(database),
			webhookDeliveries: PrismaWebhookDeliveryRepository.create(database),
		});
	}
}
