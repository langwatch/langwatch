/**
 * The whole module, from `redactSpan` down to the channels, for the two cases that must see no
 * change at all: an organization without the flag, and a deployment that names no model.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AwsPiiRedactionModelChannel } from "../../channels/aws.pii-redaction-model.channel.ts";
import { HttpDataPrivacyChannels } from "../../channels/http/http.data-privacy.channels.ts";
import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "../../channels/memory/memory.presidio.channel.ts";
import { PII_REDACTION_MODEL_FLAG } from "../../rules/pii-redaction-model.rules.ts";
import { createDataPrivacyTestApp, dataPrivacyTestGraph } from "./data-privacy.fixture.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;
const LANGEVALS = "http://langevals:5562";
const ALIAS_ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-all:live";

function spanWith(value: string): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm",
    kind: 1,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: [{ key: "langwatch.input", value: { stringValue: value } }],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/** Every flag read, answered off: no organization here has the model flag. */
function flagsOff() {
  const reads: string[] = [];
  const featureFlags = createApiFixture<FeatureFlagApi>({
    isEnabled: async (key) => {
      reads.push(key);
      return false;
    },
  });
  return { featureFlags, reads };
}

const permissions = createApiFixture<AuthzApi>({
  checkScopeLineage: async () => ({ kind: "consistent" }),
});

/** Presidio answering one batch, as langevals would. */
function presidioAnswering(): MemoryPresidioChannel {
  const presidio = MemoryPresidioChannel.create({ endpoint: LANGEVALS });
  presidio.answerWith({
    kind: "detected",
    results: [{ status: "processed", raw_response: { anonymized: "call <PERSON>" } }],
  });
  return presidio;
}

const sentBatches = (channel: MemoryPresidioChannel) =>
  channel.batches.filter((batch) => batch.texts.length > 0);

async function redactStrict(app: Awaited<ReturnType<typeof createDataPrivacyTestApp>>) {
  const span = spanWith("call Ana");
  await app.redactSpan({ span, resource: null, piiRedactionLevel: "STRICT", tenantId: PROJECT_ID });
  return span.attributes[0]?.value.stringValue;
}

describe("given the PII redaction model wired into the module", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the deployment names the model's Lambda alias", () => {
    describe("and the organization does not have the flag", () => {
      /** @scenario "An organization not allowlisted keeps the Presidio path" */
      it("redacts through Presidio and never invokes the Lambda", async () => {
        const invokes: unknown[] = [];
        const lambda = {
          send: (command: unknown) => {
            invokes.push(command);
            return Promise.reject(new Error("the model must not be invoked"));
          },
        } as never;
        const presidio = presidioAnswering();
        const { featureFlags, reads } = flagsOff();
        const app = await createDataPrivacyTestApp({
          dependencies: { featureFlags, permissions },
          settings: { langevalsEndpoint: LANGEVALS, piiRedactionModelLambdaArn: ALIAS_ARN },
          channels: async () => ({
            presidio,
            piiRedactionModel: AwsPiiRedactionModelChannel.create({
              lambda,
              functionArn: ALIAS_ARN,
            }),
            dlp: MemoryGoogleDlpChannel.create(),
          }),
        });

        const redacted = await redactStrict(app);

        expect(redacted).toBe("call [PERSON]");
        expect(sentBatches(presidio)).toHaveLength(1);
        expect(invokes).toHaveLength(0);
        expect(reads).toContain(PII_REDACTION_MODEL_FLAG);
      });
    });
  });

  describe("when the deployment names no model", () => {
    /** @scenario "A deployment that names no model behaves exactly as today" */
    it("redacts through Presidio, reads no model flag and sends nothing to a model", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const presidio = presidioAnswering();
      const { featureFlags, reads } = flagsOff();
      const app = await createDataPrivacyTestApp({
        dependencies: { featureFlags, permissions },
        settings: { langevalsEndpoint: LANGEVALS },
        channels: async (config) => ({
          // The model channel is composed from the settings exactly as in production.
          ...(await HttpDataPrivacyChannels.create({
            config,
            secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
          })),
          presidio,
          dlp: MemoryGoogleDlpChannel.create(),
        }),
      });

      const redacted = await redactStrict(app);

      expect(redacted).toBe("call [PERSON]");
      expect(sentBatches(presidio)).toHaveLength(1);
      expect(reads).not.toContain(PII_REDACTION_MODEL_FLAG);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
