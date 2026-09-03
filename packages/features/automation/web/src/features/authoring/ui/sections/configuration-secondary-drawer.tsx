import type { EmailPreview, SlackPreview, WebhookPreview } from "@langwatch/automation-contract";
import { TriggerAction } from "@langwatch/automation-contract";
import type { NotifyPreview } from "./client-providers";
import type { ConfigFormCtx } from "../../../../model/provider-types";
import { CLIENT_PROVIDERS } from "./client-providers";
import { useAutomationStore } from "./automation-store";
import { SecondaryDrawerShell } from "./secondary-drawer-shell";

/**
 * Configuration secondary drawer. Delegates the type-specific UI to the
 * active provider's `ConfigForm`. Identity fields (name + alert type)
 * live on the main drawer now, so this surface is purely about the
 * destination — recipients, templates, dataset target, etc.
 */
export function ConfigurationSecondaryDrawer({
  open,
  ctx,
  onDone,
}: {
  open: boolean;
  ctx: ConfigFormCtx<NotifyPreview>;
  onDone: () => void;
}) {
  const draft = useAutomationStore((s) => s.draft);
  const dispatch = useAutomationStore((s) => s.dispatch);

  if (!draft.action) {
    return (
      <SecondaryDrawerShell open={open} title="Setup" onClose={onDone} onDone={onDone}>
        Choose a type first.
      </SecondaryDrawerShell>
    );
  }

  const action = draft.action;
  const title = `${CLIENT_PROVIDERS[action].shared.label} setup`;
  const content = (() => {
    switch (action) {
      case TriggerAction.SEND_EMAIL: {
        const Form = CLIENT_PROVIDERS.SEND_EMAIL.client.ConfigForm;
        return (
          <Form
            slice={draft.slices.SEND_EMAIL}
            onChange={(next) => dispatch({ type: "SET_SLICE", action, slice: next })}
            ctx={emailContext(ctx)}
          />
        );
      }
      case TriggerAction.SEND_SLACK_MESSAGE: {
        const Form = CLIENT_PROVIDERS.SEND_SLACK_MESSAGE.client.ConfigForm;
        return (
          <Form
            slice={draft.slices.SEND_SLACK_MESSAGE}
            onChange={(next) => dispatch({ type: "SET_SLICE", action, slice: next })}
            ctx={slackContext(ctx)}
          />
        );
      }
      case TriggerAction.SEND_WEBHOOK: {
        const Form = CLIENT_PROVIDERS.SEND_WEBHOOK.client.ConfigForm;
        return (
          <Form
            slice={draft.slices.SEND_WEBHOOK}
            onChange={(next) => dispatch({ type: "SET_SLICE", action, slice: next })}
            ctx={webhookContext(ctx)}
          />
        );
      }
      case TriggerAction.ADD_TO_DATASET: {
        const Form = CLIENT_PROVIDERS.ADD_TO_DATASET.client.ConfigForm;
        return (
          <Form
            slice={draft.slices.ADD_TO_DATASET}
            onChange={(next) => dispatch({ type: "SET_SLICE", action, slice: next })}
            ctx={ctx}
          />
        );
      }
      case TriggerAction.ADD_TO_ANNOTATION_QUEUE: {
        const Form = CLIENT_PROVIDERS.ADD_TO_ANNOTATION_QUEUE.client.ConfigForm;
        return (
          <Form
            slice={draft.slices.ADD_TO_ANNOTATION_QUEUE}
            onChange={(next) => dispatch({ type: "SET_SLICE", action, slice: next })}
            ctx={ctx}
          />
        );
      }
    }
  })();

  return (
    <SecondaryDrawerShell open={open} title={title} onClose={onDone} onDone={onDone}>
      {content}
    </SecondaryDrawerShell>
  );
}

function emailContext(ctx: ConfigFormCtx<NotifyPreview>): ConfigFormCtx<EmailPreview> {
  return {
    ...ctx,
    preview: ctx.preview?.channel === "email" ? ctx.preview : undefined,
  };
}

function slackContext(ctx: ConfigFormCtx<NotifyPreview>): ConfigFormCtx<SlackPreview> {
  return {
    ...ctx,
    preview: ctx.preview?.channel === "slack" ? ctx.preview : undefined,
  };
}

function webhookContext(ctx: ConfigFormCtx<NotifyPreview>): ConfigFormCtx<WebhookPreview> {
  return {
    ...ctx,
    preview: ctx.preview?.channel === "webhook" ? ctx.preview : undefined,
  };
}
