import { z } from "zod/v4";
import type { PreviewEnvelope, SharedDef } from "../provider-types";

export const SLACK_TEMPLATE_TYPES = ["string", "block_kit"] as const;
export const slackTemplateTypeSchema = z.enum(SLACK_TEMPLATE_TYPES);
export type SlackTemplateType = z.infer<typeof slackTemplateTypeSchema>;

export const SLACK_DELIVERY_METHODS = ["webhook", "bot"] as const;
export const slackDeliveryMethodSchema = z.enum(SLACK_DELIVERY_METHODS);
export type SlackDeliveryMethod = (typeof SLACK_DELIVERY_METHODS)[number];
export const SLACK_BOT_TOKEN_KEPT = "__kept__";

export const slackActionParamsSchema = z
	.object({
		slackDelivery: slackDeliveryMethodSchema.optional(),
		slackWebhook: z.string().optional(),
		slackBotToken: z.string().optional(),
		slackChannelId: z.string().optional(),
		slackBotTokenSet: z.boolean().optional(),
	})
	.superRefine((params, context) => {
		const method = params.slackDelivery ?? "webhook";
		if (method === "webhook") {
			const url = params.slackWebhook?.trim();
			if (!url) {
				context.addIssue({
					code: "custom",
					message: "A Slack incoming webhook URL is required.",
					path: ["slackWebhook"],
				});
			} else if (!url.startsWith("https://hooks.slack.com/")) {
				context.addIssue({
					code: "custom",
					message:
						"Expected a Slack incoming webhook URL (https://hooks.slack.com/…).",
					path: ["slackWebhook"],
				});
			}
		} else if (!params.slackChannelId?.trim()) {
			context.addIssue({
				code: "custom",
				message: "A Slack channel is required for a bot connection.",
				path: ["slackChannelId"],
			});
		}
	});
export type SlackActionParams = z.infer<typeof slackActionParamsSchema>;

export function slackDeliveryMethodOf(
	params: Pick<SlackActionParams, "slackDelivery">,
): SlackDeliveryMethod {
	return params.slackDelivery ?? "webhook";
}

export type SlackPreviewPayload =
	| { text: string }
	| { blocks: Record<string, unknown>[] };
export interface SlackPreview extends PreviewEnvelope {
	channel: "slack";
	payload: SlackPreviewPayload;
}

const definition: SharedDef = {
	action: "SEND_SLACK_MESSAGE",
	category: "notify",
	label: "Slack",
	description: "Post a message to a Slack webhook when a trace matches.",
	alertDescription: "Post a message to a Slack webhook when the alert fires.",
	actionParamsSchema: slackActionParamsSchema,
};

export default definition;
