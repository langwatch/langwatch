import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CLIENT_PROVIDERS } from "../client";
import type { AnnotationQueueSlice } from "../definitions/annotationQueue/client";
import { annotationQueueActionParamsSchema } from "../definitions/annotationQueue/shared";
import {
  type DatasetSlice,
  deriveMappingFromColumns,
} from "../definitions/dataset/client";
import { datasetActionParamsSchema } from "../definitions/dataset/shared";
import type { EmailSlice } from "../definitions/email/client";
import { emailActionParamsSchema } from "../definitions/email/shared";
import type { SlackSlice } from "../definitions/slack/client";
import { slackActionParamsSchema } from "../definitions/slack/shared";
import type { SavedTriggerRow } from "../types";

/**
 * Build a `SavedTriggerRow` from a provider's `toActionParams` output so we can
 * feed it back through `fromTriggerRow`. Only `actionParams` is provider-owned
 * for the action providers; the notify template columns live at the row root
 * and are exercised separately.
 */
function rowFrom(
  action: TriggerAction,
  actionParams: unknown,
): SavedTriggerRow {
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
        if (result.success) {
          expect(result.data.datasetMapping.expansions).toEqual([]);
        }
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

      it("drops a client-supplied createdByUserId so it cannot be spoofed", () => {
        const result = annotationQueueActionParamsSchema.safeParse({
          annotators: [{ id: "u_1", name: "Ada" }],
          createdByUserId: "u_attacker",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(
            (result.data as { createdByUserId?: string }).createdByUserId,
          ).toBeUndefined();
        }
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
    describe("when serialised to a row and read back", () => {
      it("preserves the webhook through actionParams", () => {
        const client =
          CLIENT_PROVIDERS[TriggerAction.SEND_SLACK_MESSAGE].client;
        const slice: SlackSlice = {
          webhook: "https://hooks.slack.com/services/T000/B000/xyz",
          templateType: "block_kit",
          template: { value: "", usingDefault: true },
        };
        const back = client.fromTriggerRow(
          rowFrom(
            TriggerAction.SEND_SLACK_MESSAGE,
            client.toActionParams(slice),
          ),
        ) as SlackSlice;
        expect(back.webhook).toBe(slice.webhook);
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
        expect(Object.keys(mapping.mapping)).toEqual([
          "input",
          "output",
          "notes",
        ]);
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
        const client =
          CLIENT_PROVIDERS[TriggerAction.ADD_TO_ANNOTATION_QUEUE].client;
        const slice: AnnotationQueueSlice = {
          annotators: [{ id: "u_1", name: "Ada" }],
        };
        const back = client.fromTriggerRow(
          rowFrom(
            TriggerAction.ADD_TO_ANNOTATION_QUEUE,
            client.toActionParams(slice),
          ),
        ) as AnnotationQueueSlice;
        expect(back.annotators).toEqual(slice.annotators);
      });
    });
  });
});
