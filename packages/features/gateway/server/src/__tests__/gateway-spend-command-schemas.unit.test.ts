/**
 * The seam between what the gateway posts and what the pipeline appends.
 *
 * Two shapes have to keep agreeing across a deploy: the wire schema, which
 * the Go emitter is built against and must not grow requirements, and the
 * command schema, which is what already-appended events are read back
 * through. A field added to the command schema without a default turns
 * every event written before the deploy into a parse failure, so the
 * defaults are the compatibility contract and are pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  admitSpendCommandDataSchema,
  admitSpendWireSchema,
  confirmSpendWireSchema,
  failSpendWireSchema,
} from "@langwatch/gateway-server";

/** Exactly what the Go emitter sends, mapped through the ingest route. */
const wireAdmission = {
  gateway_request_id: "req_01J",
  occurred_at: Date.UTC(2026, 6, 21, 9, 0, 0),
  organization_id: "org_1",
  tenantId: "proj_1",
  virtual_key_id: "vk_1",
  model: "gpt-x",
};

describe("spend command schemas", () => {
  it("accepts the gateway's admission without the attribution the seam adds", () => {
    const parsed = admitSpendWireSchema.parse(wireAdmission);

    expect(parsed.principal_user_id).toBe("");
    expect(parsed.end_user_id).toBe("");
    expect(parsed.model_provider_id).toBe("");
  });

  it("reads an admission appended before the team was carried", () => {
    // A pre-deploy event, replayed by a post-deploy consumer: the enriched
    // field has to default rather than fail the read.
    const parsed = admitSpendCommandDataSchema.parse(wireAdmission);

    expect(parsed.team_id).toBe("");
  });

  it("keeps the enriched attribution when the seam supplied it", () => {
    const parsed = admitSpendCommandDataSchema.parse({
      ...wireAdmission,
      team_id: "team_1",
      principal_user_id: "usr_1",
    });

    expect(parsed).toMatchObject({
      team_id: "team_1",
      principal_user_id: "usr_1",
    });
  });
});

/** A confirmation the gateway posted before the audio quantities existed. */
const wireConfirmationBeforeAudio = {
  gateway_request_id: "req_01J",
  occurred_at: Date.UTC(2026, 6, 21, 9, 0, 0),
  tenantId: "proj_1",
  usage: {
    input_tokens: 869,
    output_tokens: 207,
    cache_read_input_tokens: 11,
    cache_creation_input_tokens: 5,
    reasoning_tokens: 0,
  },
};

describe("the spend quantity vocabulary", () => {
  describe("given a confirmation recorded before the audio quantities existed", () => {
    describe("when it is read back", () => {
      /** @scenario A quantity added to the vocabulary defaults on records written before it */
      it("defaults every quantity it never carried", () => {
        const parsed = confirmSpendWireSchema.parse(wireConfirmationBeforeAudio);

        expect(parsed.usage).toEqual({
          input_tokens: 869,
          output_tokens: 207,
          cache_read_input_tokens: 11,
          cache_creation_input_tokens: 5,
          cache_creation_1h_tokens: 0,
          reasoning_tokens: 0,
          input_audio_tokens: 0,
          output_audio_tokens: 0,
          input_chars: 0,
          audio_ms: 0,
        });
      });
    });
  });

  describe("given a confirmation a current gateway sent", () => {
    describe("when it is read back", () => {
      /** @scenario The confirm command carries every billable quantity, not only token classes */
      it("keeps every quantity it carried", () => {
        const parsed = confirmSpendWireSchema.parse({
          ...wireConfirmationBeforeAudio,
          usage: {
            input_tokens: 200,
            input_audio_tokens: 800,
            output_tokens: 50,
            output_audio_tokens: 250,
            input_chars: 4000,
            audio_ms: 1234,
            cache_creation_1h_tokens: 17,
          },
        });

        expect(parsed.usage).toMatchObject({
          input_audio_tokens: 800,
          output_audio_tokens: 250,
          input_chars: 4000,
          audio_ms: 1234,
          cache_creation_1h_tokens: 17,
        });
      });
    });
  });

  describe("given a failure that carried no usage at all", () => {
    describe("when it is read back", () => {
      /** @scenario A quantity added to the vocabulary defaults on records written before it */
      it("defaults every quantity to zero", () => {
        const parsed = failSpendWireSchema.parse({
          gateway_request_id: "req_01J",
          occurred_at: Date.UTC(2026, 6, 21, 9, 0, 0),
          tenantId: "proj_1",
          error: { type: "provider_timeout", http_status: 504 },
        });

        expect(parsed.usage.input_chars).toBe(0);
        expect(parsed.usage.audio_ms).toBe(0);
        expect(parsed.usage.input_audio_tokens).toBe(0);
      });
    });
  });
});
