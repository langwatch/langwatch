import {
  defaultsForSourceKind,
  EXAMPLE_MATCHES,
  renderTriggerEmail,
  renderTriggerSlack,
  renderWebhookBody,
  TemplateValidationError,
  TestFireUnavailableError,
  validateLiquid,
  buildExampleGraphAlertTemplateContext,
  buildExampleReportTemplateContext,
  buildTemplateContext,
  type GraphAlertTemplateContext,
  type ReportTemplateContext,
  type SlackTemplateType,
  type TemplateContext,
  type TemplateSourceKind,
  type TestFireInput,
  type TestFireResult,
  type TestFireTemplateDraft,
} from "@langwatch/automation-contract";
import type { AutomationTestFirePort } from "../ports/automation-test-fire.port";

const SLACK_TEMPLATE_TYPES = ["string", "block_kit"] as const;
const SLACK_TEMPLATE_TYPE_SET: ReadonlySet<string> = new Set(SLACK_TEMPLATE_TYPES);
const LIQUID_TEMPLATE_COLUMNS = [
  "slackTemplate",
  "emailSubjectTemplate",
  "emailBodyTemplate",
] as const satisfies readonly (keyof TestFireTemplateDraft)[];

type TestFireContext = {
  sourceKind: TemplateSourceKind;
  context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext;
};

export class AutomationTemplateService {
  private constructor(
    private readonly baseHost: string,
    private readonly delivery: AutomationTestFirePort,
  ) {}

  static create(input: {
    baseHost: string;
    delivery: AutomationTestFirePort;
  }): AutomationTemplateService {
    return new AutomationTemplateService(input.baseHost, input.delivery);
  }

  validate(draft: TestFireTemplateDraft): void {
    this.validateSlackType(draft);

    for (const column of LIQUID_TEMPLATE_COLUMNS) {
      const source = draft[column];
      if (typeof source !== "string" || source.trim() === "") {
        continue;
      }

      const result = validateLiquid(source);
      if (!result.valid) {
        throw new TemplateValidationError(
          column,
          result.error ?? "Invalid Liquid syntax",
        );
      }
    }
  }

  async testFire(input: TestFireInput): Promise<TestFireResult> {
    this.validate(input.draft);

    const testContext = this.buildContext(input);
    const defaults = defaultsForSourceKind(testContext.sourceKind);

    if (input.channel === "email") {
      return this.sendEmail(input, testContext.context, defaults);
    }

    if (input.channel === "webhook") {
      return this.sendWebhook(input, testContext.context, defaults.webhookBody);
    }

    return this.sendSlack(input, testContext.context, defaults);
  }

  private validateSlackType(draft: TestFireTemplateDraft): void {
    const type = draft.slackTemplateType;
    const knownType =
      type === null || type === void 0 || SLACK_TEMPLATE_TYPE_SET.has(type);

    if (!knownType) {
      throw new TemplateValidationError(
        "slackTemplateType",
        `Invalid Slack template type "${type}". Allowed: ${SLACK_TEMPLATE_TYPES.join(", ")}.`,
      );
    }

    const source = draft.slackTemplate;
    const hasSource = typeof source === "string" && source.trim() !== "";
    if (hasSource && type == null) {
      throw new TemplateValidationError(
        "slackTemplateType",
        'slackTemplate is set but slackTemplateType is missing. Pick "string" or "block_kit".',
      );
    }
  }

  private buildContext(input: TestFireInput): TestFireContext {
    if (input.report) {
      return {
        sourceKind: "report",
        context: buildExampleReportTemplateContext({
          baseHost: this.baseHost,
          project: input.project,
          trigger: { name: input.trigger.name },
          sourceKind: input.report.sourceKind,
          scheduleLabel: input.report.scheduleLabel,
        }),
      };
    }

    if (input.graphAlert) {
      return {
        sourceKind: "graphAlert",
        context: buildExampleGraphAlertTemplateContext({
          baseHost: this.baseHost,
          project: input.project,
          trigger: input.trigger,
          graph: { name: input.graphAlert.graphName },
          metricLabel: input.graphAlert.metricLabel,
          condition: {
            operator: input.graphAlert.operator,
            threshold: input.graphAlert.threshold,
            timePeriodMinutes: input.graphAlert.timePeriodMinutes,
          },
        }),
      };
    }

    return {
      sourceKind: "trace",
      context: buildTemplateContext({
        trigger: {
          id: "preview",
          name: input.trigger.name,
          alertType: input.trigger.alertType,
        },
        project: input.project,
        baseHost: this.baseHost,
        matches: EXAMPLE_MATCHES,
      }),
    };
  }

  private async sendEmail(
    input: TestFireInput,
    context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext,
    defaults: ReturnType<typeof defaultsForSourceKind>,
  ): Promise<TestFireResult> {
    if (input.recipients.length === 0) {
      throw new TestFireUnavailableError(
        "email",
        "This automation has no email recipients to test-fire to.",
      );
    }

    const rendered = await renderTriggerEmail({
      subjectTemplate: input.draft.emailSubjectTemplate ?? null,
      bodyTemplate: input.draft.emailBodyTemplate ?? null,
      context,
      defaults,
      testFire: true,
    });

    await this.delivery.sendEmail({
      recipients: input.recipients,
      subject: rendered.subject,
      html: rendered.html,
    });

    return {
      channel: "email",
      recipientCount: input.recipients.length,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  }

  private async sendWebhook(
    input: TestFireInput,
    context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext,
    defaultBody: string,
  ): Promise<TestFireResult> {
    const destination = input.webhookDestination;
    if (!destination) {
      throw new TestFireUnavailableError(
        "webhook",
        "This automation has no endpoint URL to test-fire to.",
      );
    }

    const rendered = await renderWebhookBody({
      template: destination.bodyTemplate,
      context,
      defaultBody,
    });
    const response = await this.delivery.sendWebhook({
      url: destination.url,
      method: destination.method,
      headers: destination.headers,
      signingSecrets: destination.signingSecrets,
      body: rendered.body,
      triggerName: input.trigger.name,
    });

    return {
      channel: "webhook",
      recipientCount: 1,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
      httpStatus: response.status,
    };
  }

  private async sendSlack(
    input: TestFireInput,
    context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext,
    defaults: ReturnType<typeof defaultsForSourceKind>,
  ): Promise<TestFireResult> {
    const rendered = await renderTriggerSlack({
      templateType: this.slackType(input.draft.slackTemplateType),
      template: input.draft.slackTemplate ?? null,
      context,
      defaults,
      testFire: true,
      allowGatedBlocks: input.botDestination ? true : void 0,
    });

    if (input.botDestination) {
      await this.delivery.sendSlackBot({
        ...input.botDestination,
        payload: rendered.payload,
      });
    } else {
      if (!input.webhook) {
        throw new TestFireUnavailableError(
          "slack",
          "This automation has no Slack webhook to test-fire to.",
        );
      }

      await this.delivery.sendSlack({
        webhook: input.webhook,
        payload: rendered.payload,
      });
    }

    return {
      channel: "slack",
      recipientCount: 1,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  }

  private slackType(value: string | null | undefined): SlackTemplateType | null {
    return value === "string" || value === "block_kit" ? value : null;
  }
}
