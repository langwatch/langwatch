import {
	AutomationService as AutomationCapability,
	createTriggerCommandSchema,
	InvalidUnsubscribeTokenError,
	maskEmail,
	suppressEmailCommandSchema,
	type CreateTriggerCommand,
	type EmailSuppression,
	type ReportSchedule,
	type SuppressEmailCommand,
	type Trigger,
	type TriggerFire,
	type TriggerFireStats,
	type TriggerSummary,
	type UpdateTriggerCommand,
	updateTriggerCommandSchema,
} from "@langwatch/automation-contract";
import type {
	CustomGraph,
	CustomGraphNameRef,
	WebhookDeliveryInput,
	WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import { EmailSuppressionNameRepository } from "../repositories/email-suppression-name.repository";
import { EmailSuppressionRepository } from "../repositories/email-suppression.repository";
import { TriggerFireHistoryRepository } from "../repositories/trigger-fire-history.repository";
import { TriggerRepository } from "../repositories/trigger.repository";
import { UnsubscribeTokenVerifier } from "../ports/unsubscribe-token.port";
import { AutomationClock } from "../ports/automation-clock.port";
import { ReportScheduleService } from "./report-schedule.service";
import { CustomGraphRepository } from "../repositories/custom-graph.repository";
import { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository";

const normalize = (email: string): string => email.trim().toLowerCase();
/** Canonical process service for all Automation behaviour: trigger lifecycle,
 * dispatch claims/history, and email suppression. It receives only private
 * Automation repositories and token/name capabilities. */
export class AutomationService extends AutomationCapability {
	private readonly activeCache = new Map<
		string,
		{ expires: number; value: TriggerSummary[] }
	>();
	private constructor(
		private readonly triggers: TriggerRepository,
		private readonly history: TriggerFireHistoryRepository,
		private readonly suppressions: EmailSuppressionRepository,
		private readonly names: EmailSuppressionNameRepository,
		private readonly verifier: UnsubscribeTokenVerifier,
		private readonly reportSchedules: ReportScheduleService,
		private readonly clock: AutomationClock,
		private readonly customGraphs: CustomGraphRepository,
		private readonly webhookDeliveries: WebhookDeliveryRepository,
	) {
		super();
	}
	static create(deps: {
		triggers: TriggerRepository;
		history: TriggerFireHistoryRepository;
		suppressions: EmailSuppressionRepository;
		names: EmailSuppressionNameRepository;
		verifier: UnsubscribeTokenVerifier;
		reportSchedules: ReportScheduleService;
		clock: AutomationClock;
		customGraphs: CustomGraphRepository;
		webhookDeliveries: WebhookDeliveryRepository;
	}): AutomationService {
		return new AutomationService(
			deps.triggers,
			deps.history,
			deps.suppressions,
			deps.names,
			deps.verifier,
			deps.reportSchedules,
			deps.clock,
			deps.customGraphs,
			deps.webhookDeliveries,
		);
	}
	private async active(projectId: string): Promise<TriggerSummary[]> {
		const cached = this.activeCache.get(projectId);
		if (cached && cached.expires > this.clock.now().getTime())
			return cached.value;
		const value = await this.triggers.findActiveForProject(projectId);
		this.activeCache.set(projectId, {
			expires: this.clock.now().getTime() + 60_000,
			value,
		});
		return value;
	}
	getById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
		return this.triggers.findByIdOrThrow(input);
	}
	tryGetById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
		return this.triggers.tryFindById(input);
	}
	getAllForProject(input: { projectId: string }): Promise<Trigger[]> {
		return this.triggers.findAllByProjectId(input);
	}
	async create(input: CreateTriggerCommand): Promise<Trigger> {
		const trigger = await this.triggers.create(createTriggerCommandSchema.parse(input));
		await this.invalidate(input.projectId);
		return trigger;
	}
	async update(input: UpdateTriggerCommand): Promise<Trigger> {
		const trigger = await this.triggers.update(updateTriggerCommandSchema.parse(input));
		await this.invalidate(input.projectId);
		return trigger;
	}
	async archive(input: {
		triggerId: string;
		projectId: string;
	}): Promise<Trigger> {
		await this.getById(input);
		const trigger = await this.triggers.update({
			id: input.triggerId,
			projectId: input.projectId,
			active: false,
		});
		await this.invalidate(input.projectId);
		return trigger;
	}
	async softDeleteById(input: {
		triggerId: string;
		projectId: string;
	}): Promise<Trigger> {
		const trigger = await this.triggers.update({
			id: input.triggerId,
			projectId: input.projectId,
			active: false,
			deleted: true,
		});
		await this.invalidate(input.projectId);
		return trigger;
	}
	tryGetByCustomGraphId(input: {
		projectId: string;
		customGraphId: string;
	}): Promise<Trigger | null> {
		return this.triggers.tryFindByCustomGraphId(input);
	}
	getByCustomGraphIds(input: {
		projectId: string;
		customGraphIds: string[];
	}): Promise<Trigger[]> {
		return this.triggers.findByCustomGraphIds(input);
	}
	async getActiveTraceTriggersForProject(
		projectId: string,
	): Promise<TriggerSummary[]> {
		return (await this.active(projectId)).filter(
			(trigger) => !trigger.customGraphId && trigger.triggerKind !== "REPORT",
		);
	}
	async getActiveGraphTriggersForProject(
		projectId: string,
	): Promise<TriggerSummary[]> {
		return (await this.active(projectId)).filter(
			(trigger) =>
				trigger.customGraphId !== null && trigger.triggerKind !== "REPORT",
		);
	}
	claimSend(input: {
		triggerId: string;
		traceId: string;
		projectId: string;
	}): Promise<boolean> {
		return this.triggers.claimSend(input);
	}
	isSendClaimed(input: {
		triggerId: string;
		traceId: string;
		projectId: string;
	}): Promise<boolean> {
		return this.triggers.isSendClaimed(input);
	}
	filterSendClaimed(input: {
		triggerId: string;
		traceIds: string[];
		projectId: string;
	}): Promise<Set<string>> {
		return this.triggers.findClaimedTraceIds(input);
	}
	updateLastRunAt(input: {
		triggerId: string;
		projectId: string;
	}): Promise<void> {
		return this.triggers.updateLastRunAt(input);
	}
	invalidate(projectId: string): Promise<void> {
		this.activeCache.delete(projectId);
		return Promise.resolve();
	}
	getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]> {
		return this.reportSchedules.getAll(input);
	}
	syncReportSchedule(input: {
		projectId: string;
		triggerId: string;
		cron: string;
		timezone: string;
	}): Promise<void> {
		return this.reportSchedules.sync({
			projectId: input.projectId,
			triggerId: input.triggerId,
			schedule: { cron: input.cron, timezone: input.timezone },
		});
	}
	removeReportSchedule(input: {
		projectId: string;
		triggerId: string;
	}): Promise<void> {
		return this.reportSchedules.remove(input);
	}
	async reconcileReportSchedules(): Promise<{ repaired: number }> {
		const reports = await this.triggers.findActiveReportTargets();
		if (reports.length === 0) return { repaired: 0 };

		const scheduledTargetIds = new Set<string>();
		const projectIds = new Set(reports.map((report) => report.projectId));
		for (const projectId of projectIds) {
			const schedules = await this.reportSchedules.getAll({ projectId });
			for (const schedule of schedules) {
				scheduledTargetIds.add(schedule.triggerId);
			}
		}

		let repaired = 0;
		for (const report of reports) {
			if (scheduledTargetIds.has(report.id)) continue;

			const parsed = ReportScheduleService.tryExtract(report.actionParams);
			if (!parsed) continue;

			await this.reportSchedules.sync({
				projectId: report.projectId,
				triggerId: report.id,
				schedule: parsed.schedule,
			});
			repaired += 1;
		}

		return { repaired };
	}
	getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]> {
		return this.history.findAllStatsForProject({
			projectId: input.projectId,
			firesSince: new Date(
				this.clock.now().getTime() - 30 * 24 * 60 * 60 * 1000,
			),
		});
	}
	getRecentFires(input: {
		projectId: string;
		triggerId?: string;
		limit: number;
	}): Promise<TriggerFire[]> {
		return input.triggerId
			? this.history.findAllRecentByTriggerId({
					projectId: input.projectId,
					triggerId: input.triggerId,
					limit: input.limit,
				})
			: this.history.findAllRecentForProject({
					projectId: input.projectId,
					limit: input.limit,
				});
	}
	recordFire(input: {
		projectId: string;
		triggerId: string;
		traceId?: string | null;
		customGraphId?: string | null;
		createdAt: Date;
		resolvedAt?: Date | null;
	}): Promise<TriggerFire> {
		return this.history.create({
			projectId: input.projectId,
			triggerId: input.triggerId,
			traceId: input.traceId ?? null,
			customGraphId: input.customGraphId ?? null,
			createdAt: input.createdAt,
			resolvedAt: input.resolvedAt ?? null,
		});
	}
	getSuppressions(input: { projectId: string }): Promise<EmailSuppression[]> {
		return this.suppressions.findAll(input);
	}
	async getAllEnriched(input: {
		projectId: string;
	}): Promise<Array<EmailSuppression & { triggerName: string | null }>> {
		const rows = await this.suppressions.findAll(input);
		const ids = [
			...new Set(rows.flatMap((row) => (row.triggerId ? [row.triggerId] : []))),
		];
		const names = await this.names.findTriggerNames({
			projectId: input.projectId,
			triggerIds: ids,
		});
		return rows.map((row) => ({
			...row,
			triggerName: row.triggerId ? (names.get(row.triggerId) ?? null) : null,
		}));
	}
	async tryResolveUnsubscribeView(input: { token: string }): Promise<{
		projectName: string;
		triggerName: string | null;
		email: string;
	} | null> {
		const payload = this.verifier.tryVerify(input.token);
		if (!payload) return null;
		const names = await this.names.tryLookupNames(payload);
		if (!names) return null;
		return {
			projectName: names.projectName,
			triggerName: names.triggerName,
			email: maskEmail(payload.email),
		};
	}
	async confirmUnsubscribe(input: {
		token: string;
		scope: "trigger" | "project";
	}): Promise<void> {
		const payload = this.verifier.tryVerify(input.token);
		if (!payload) throw new InvalidUnsubscribeTokenError();
		await this.suppressEmail({
			projectId: payload.projectId,
			email: payload.email,
			triggerId: input.scope === "project" ? null : payload.triggerId,
		});
	}
	suppressEmail(input: SuppressEmailCommand): Promise<EmailSuppression> {
		const parsed = suppressEmailCommandSchema.parse(input);
		return this.suppressions.create({
			projectId: parsed.projectId,
			email: normalize(parsed.email),
			triggerId: parsed.triggerId,
			reason: parsed.reason ?? "unsubscribe",
		});
	}
	removeSuppression(input: { id: string; projectId: string }): Promise<void> {
		return this.suppressions.delete(input);
	}
	async filterSuppressed(input: {
		projectId: string;
		triggerId: string;
		emails: string[];
	}): Promise<string[]> {
		const rows = await this.suppressions.findMatching({
			projectId: input.projectId,
			triggerId: input.triggerId,
		});
		const blocked = new Set(rows.map((row) => normalize(row.email)));
		return input.emails.filter((email) => !blocked.has(normalize(email)));
	}
	tryGetCustomGraph(input: {
		customGraphId: string;
		projectId: string;
	}): Promise<CustomGraph | null> {
		return this.customGraphs.tryFindById(input);
	}
	customGraphExistsInProject(input: {
		customGraphId: string;
		projectId: string;
	}): Promise<boolean> {
		return this.customGraphs.existsInProject(input);
	}
	getCustomGraphNamesByIds(input: {
		customGraphIds: string[];
		projectId: string;
	}): Promise<CustomGraphNameRef[]> {
		return this.customGraphs.findAllNamesByIds(input);
	}
	recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void> {
		return this.webhookDeliveries.create(input);
	}
	getRecentWebhookDeliveries(input: {
		projectId: string;
		triggerId: string;
		limit: number;
	}): Promise<WebhookDeliveryRow[]> {
		return this.webhookDeliveries.findAllRecentByTriggerId(input);
	}
	pruneWebhookDeliveries(now?: Date): Promise<number> {
		return this.webhookDeliveries.pruneExpired(now);
	}
}
