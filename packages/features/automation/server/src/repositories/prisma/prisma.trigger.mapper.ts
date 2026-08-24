import {
	NOTIFICATION_CADENCES,
	triggerSchema,
	type Trigger,
} from "@langwatch/automation-contract";

const parseCadence = (value: unknown): string =>
	typeof value === "string" &&
	(NOTIFICATION_CADENCES as readonly string[]).includes(value)
		? value
		: "immediate";

export function mapTriggerRow(row: unknown): Trigger {
	const value = row as Record<string, unknown>;
	return triggerSchema.parse({
		...value,
		actionParams: value.actionParams ?? {},
		filters: value.filters ?? {},
		filterQuery: value.filterQuery ?? null,
		pausedReason: value.pausedReason ?? null,
		pausedAt: value.pausedAt ?? null,
		message: value.message ?? null,
		alertType: value.alertType ?? null,
		customGraphId: value.customGraphId ?? null,
		notificationCadence: parseCadence(value.notificationCadence),
		lastRunAt:
			typeof value.lastRunAt === "number"
				? new Date(value.lastRunAt)
				: (value.lastRunAt ?? null),
		templates: {
			slackTemplateType: value.slackTemplateType ?? null,
			slackTemplate: value.slackTemplate ?? null,
			emailSubjectTemplate: value.emailSubjectTemplate ?? null,
			emailBodyTemplate: value.emailBodyTemplate ?? null,
		},
	});
}
