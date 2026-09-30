import {
  annotationQueueActionParamsSchema,
  datasetActionParamsSchema,
  emailActionParamsSchema,
  slackActionParamsSchema,
  TriggerAction,
} from "@langwatch/automation-contract";
import type { SavedTriggerRow } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import type { AnnotationQueueSlice } from "../ui/sections/annotation-queue.client.tsx";
import { CLIENT_PROVIDERS } from "../ui/sections/client-providers.ts";
import { type DatasetSlice, deriveMappingFromColumns } from "../ui/sections/dataset.client.tsx";
import type { EmailSlice } from "../ui/sections/email.client.tsx";
import type { SlackSlice } from "../ui/sections/slack.client.tsx";

/**
 * Builds a `SavedTriggerRow` from a provider's `toActionParams` output,
 * to feed back through `fromTriggerRow`. Only `actionParams` is
 * provider-owned; notify template columns live at the row root.
 */
function rowFrom(action: TriggerAction, actionParams: unknown): SavedTriggerRow {
  return {
    id: "tr_test",
    name: "Round trip",
    alertType: null,
    action,
    actionParams,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    slackTemplate: null,
    slackTemplateType: null,
  };
}

describe("provider actionParams schemas", () => {
  describe("given the email schema", () => {
    describe("when validating recipient lists", () => {
      it("accepts a list of well-formed addresses", () => {
        const result = emailActionParamsSchema.safeParse({
          members: ["alerts@acme.com", "ops@acme.com"],
        });
        expect(result.success).toBe(true);
      });

      it("rejects a malformed email address", () => {
        const result = emailActionParamsSchema.safeParse({
          members: ["not-an-email"],
        });
        expect(result.success).toBe(false);
      });

      it("rejects an address carrying a header-injection newline", () => {
        const result = emailActionParamsSchema.safeParse({
          members: ["a@b.com\nBcc: evil@x.com"],
        });
        expect(result.success).toBe(false);
      });

      it("rejects an empty recipient list", () => {
        const result = emailActionParamsSchema.safeParse({ members: [] });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given the slack schema", () => {
    describe("when validating the webhook URL", () => {
      it("accepts a hooks.slack.com incoming webhook", () => {
        const result = slackActionParamsSchema.safeParse({
          slackWebhook: "https://hooks.slack.com/services/T000/B000/xyz",
        });
        expect(result.success).toBe(true);
      });

      it("rejects a URL without the hooks.slack.com prefix", () => {
        const result = slackActionParamsSchema.safeParse({
          slackWebhook: "https://example.com/webhook",
        });
        expect(result.success).toBe(false);
      });

      it("rejects a non-URL string", () => {
        const result = slackActionParamsSchema.safeParse({
          slackWebhook: "not a url",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given the dataset schema", () => {
    const validMapping = deriveMappingFromColumns([
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ]);

    describe("when validating the dataset target and mapping", () => {
      it("accepts a dataset id with a non-empty mapping", () => {
        const result = datasetActionParamsSchema.safeParse({
          datasetId: "ds_1",
          datasetMapping: validMapping,
        });
        expect(result.success).toBe(true);
      });

      it("defaults expansions to an empty array when omitted", () => {
        const result = datasetActionParamsSchema.safeParse({
          datasetId: "ds_1",
          datasetMapping: { mapping: validMapping.mapping },
        });
        expect(result.success).toBe(true);
        if (!result.success) throw new Error("unreachable: asserted above");
        expect(result.data.datasetMapping.expansions).toEqual([]);
      });

      it("rejects an empty datasetId", () => {
        const result = datasetActionParamsSchema.safeParse({
          datasetId: "",
          datasetMapping: validMapping,
        });
        expect(result.success).toBe(false);
      });

      it("rejects a missing datasetMapping", () => {
        const result = datasetActionParamsSchema.safeParse({
          datasetId: "ds_1",
        });
        expect(result.success).toBe(false);
      });

      it("rejects a mapping entry without a source", () => {
        const result = datasetActionParamsSchema.safeParse({
          datasetId: "ds_1",
          datasetMapping: { mapping: { input: { key: "input" } } },
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given the annotation-queue schema", () => {
    describe("when validating the annotator list", () => {
      it("accepts at least one annotator", () => {
        const result = annotationQueueActionParamsSchema.safeParse({
          annotators: [{ id: "u_1", name: "Ada" }],
        });
        expect(result.success).toBe(true);
      });

      it("rejects an empty annotator list", () => {
        const result = annotationQueueActionParamsSchema.safeParse({
          annotators: [],
        });
        expect(result.success).toBe(false);
      });
    });
  });
});

describe("provider slice round trips", () => {
  describe("given an email slice", () => {
    describe("when serialised to a row and read back", () => {
      it("preserves the recipient list through actionParams", () => {
        const client = CLIENT_PROVIDERS[TriggerAction.SEND_EMAIL].client;
        const slice: EmailSlice = {
          members: ["alerts@acme.com"],
          subject: { value: "", usingDefault: true },
          body: { value: "", usingDefault: true },
        };
        const back = client.fromTriggerRow(
          rowFrom(TriggerAction.SEND_EMAIL, client.toActionParams(slice)),
        ) as EmailSlice;
        expect(back.members).toEqual(slice.members);
      });
    });
  });

  describe("given a slack slice", () => {
    const client = CLIENT_PROVIDERS[TriggerAction.SEND_SLACK_MESSAGE].client;
    const baseSlackSlice: SlackSlice = {
      slackIntegrationId: "",
      deliveryMethod: "webhook",
      channelId: "",
      legacyParams: null,
      templateType: "block_kit",
      template: { value: "", usingDefault: true },
    };
    const roundTrip = (slice: SlackSlice) =>
      client.fromTriggerRow(
        rowFrom(TriggerAction.SEND_SLACK_MESSAGE, client.toActionParams(slice)),
      ) as SlackSlice;

    describe("when a webhook connection is serialised and read back", () => {
      it("preserves the connection and the delivery method", () => {
        const back = roundTrip({ ...baseSlackSlice, slackIntegrationId: "conn-hook" });

        expect(back.slackIntegrationId).toBe("conn-hook");
        expect(back.deliveryMethod).toBe("webhook");
        expect(back.legacyParams).toBeNull();
      });
    });

    describe("when a bot connection is serialised and read back", () => {
      it("preserves the connection and the channel", () => {
        const back = roundTrip({
          ...baseSlackSlice,
          slackIntegrationId: "conn-bot",
          deliveryMethod: "bot",
          channelId: "C0123",
        });

        expect(back.slackIntegrationId).toBe("conn-bot");
        expect(back.deliveryMethod).toBe("bot");
        expect(back.channelId).toBe("C0123");
      });
    });

    describe("when a legacy bot row is read and written back", () => {
      it("writes back its method and channel, and the server moves the token it stores", () => {
        // The read returns no token (see `readableSlackActionParams`).
        const slice = client.fromTriggerRow(
          rowFrom(TriggerAction.SEND_SLACK_MESSAGE, {
            slackDelivery: "bot",
            slackChannelId: "C0123",
          }),
        ) as SlackSlice;

        expect(client.toActionParams(slice)).toEqual({
          slackDelivery: "bot",
          slackChannelId: "C0123",
        });
      });
    });
  });

  describe("given a dataset slice", () => {
    describe("when serialised to a row and read back", () => {
      it("preserves the dataset id and non-empty mapping", () => {
        const client = CLIENT_PROVIDERS[TriggerAction.ADD_TO_DATASET].client;
        const slice: DatasetSlice = {
          datasetId: "ds_1",
          mapping: deriveMappingFromColumns([
            { name: "input", type: "string" },
            { name: "notes", type: "string" },
          ]),
        };
        const back = client.fromTriggerRow(
          rowFrom(TriggerAction.ADD_TO_DATASET, client.toActionParams(slice)),
        ) as DatasetSlice;
        expect(back.datasetId).toBe("ds_1");
        expect(Object.keys(back.mapping.mapping).length).toBeGreaterThan(0);
        expect(back.mapping).toEqual(slice.mapping);
      });
    });

    describe("when a dataset has columns", () => {
      it("derives a mapping entry for every column", () => {
        const mapping = deriveMappingFromColumns([
          { name: "input", type: "string" },
          { name: "output", type: "string" },
          { name: "notes", type: "string" },
        ]);
        expect(Object.keys(mapping.mapping)).toEqual(["input", "output", "notes"]);
        // Known columns map to their obvious source; unknown columns fall back
        // to the trace metadata field of the same name — never a blank source.
        expect(mapping.mapping.input?.source).toBe("input");
        expect(mapping.mapping.output?.source).toBe("output");
        expect(mapping.mapping.notes).toEqual({
          source: "metadata",
          key: "notes",
          subkey: "",
        });
      });
    });
  });

  describe("given an annotation-queue slice", () => {
    describe("when serialised to a row and read back", () => {
      it("preserves the annotator list", () => {
        const client = CLIENT_PROVIDERS[TriggerAction.ADD_TO_ANNOTATION_QUEUE].client;
        const slice: AnnotationQueueSlice = {
          annotators: [{ id: "u_1", name: "Ada" }],
        };
        const back = client.fromTriggerRow(
          rowFrom(TriggerAction.ADD_TO_ANNOTATION_QUEUE, client.toActionParams(slice)),
        ) as AnnotationQueueSlice;
        expect(back.annotators).toEqual(slice.annotators);
      });
    });
  });
});
