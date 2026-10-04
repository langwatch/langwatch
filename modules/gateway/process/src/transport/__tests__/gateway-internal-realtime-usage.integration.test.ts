/**
 * @vitest-environment node
 * The realtime session routes of the Go data plane's door, on the real router: what a
 * reservation stores and what a usage report answers.
 * Spec: modules/gateway/specs/gateway-realtime-session-metering.feature
 */
import { describe, expect, it } from "vitest";

import type { GatewaySpendConfirmation } from "../../app/gateway.members.ts";
import type { ConfirmSpendCommandData } from "../../eventing/gateway-spend-commands.process.ts";
import { MemoryGatewayRealtimeSessionRepository } from "../../repositories/memory/memory.gateway-realtime-session.repository.ts";
import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";
import { ModelCatalogGatewaySpendRatingService } from "../../services/model-catalog-gateway-spend-rating.service.ts";
import {
  mountGatewayInternalRest,
  signedGatewayRequest,
} from "./support/gateway-internal-rest.harness.ts";

const SESSIONS_PATH = "/api/internal/gateway/realtime-sessions";
const MODEL = "openai/gpt-realtime-1.5";
const rating = ModelCatalogGatewaySpendRatingService.create();

class RecordingSpendConfirmation implements GatewaySpendConfirmation {
  readonly sent: ConfirmSpendCommandData[] = [];

  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    this.sent.push(data);
  }
}

function door() {
  const sessions = MemoryGatewayRealtimeSessionRepository.create();
  const spend = new RecordingSpendConfirmation();
  const app = mountGatewayInternalRest({
    realtimeSessions: { sessions, spendRating: rating, spendConfirmation: spend },
  });
  const send = async (input: { method: string; path: string; body: unknown }) => {
    const response = await app.fetch(signedGatewayRequest(input));

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const reserve = (extra: Record<string, unknown> = {}) =>
    send({
      method: "POST",
      path: SESSIONS_PATH,
      body: {
        session_id: "session-1",
        project_id: "project-1",
        organization_id: "organization-1",
        virtual_key_id: "key-1",
        model_provider_id: "provider-1",
        vendor: "openai",
        model: MODEL,
        ...extra,
      },
    });
  const usage = (body: Record<string, unknown>, sessionId = "session-1") =>
    send({
      method: "POST",
      path: `${SESSIONS_PATH}/${sessionId}/usage`,
      body: { project_id: "project-1", virtual_key_id: "key-1", ...body },
    });

  return { sessions, spend, send, reserve, usage };
}

describe("the internal realtime usage route", () => {
  describe("when the gateway posts a keyed usage report", () => {
    /** @scenario "The internal usage route answers what the report did and what it cost" */
    it("answers the status, the costs and the budget verdict", async () => {
      const { sessions, reserve, usage } = door();
      const credentialExpiresAt = 1_800_000_600_000;
      await reserve({
        kind: "realtime",
        metering: "gateway",
        transcription_model: "elevenlabs/scribe_v1",
        credential_expires_at: credentialExpiresAt,
      });
      const quantities = { input_audio_tokens: 100, output_audio_tokens: 50 };
      const cost = rating.rate({
        model: MODEL,
        usage: { ...EMPTY_SPEND_USAGE, ...quantities },
      }).costNanoUsd;

      const recorded = await usage({ report_key: "resp_1", usage: quantities, source: "gateway" });
      const again = await usage({ report_key: "resp_1", usage: quantities, source: "gateway" });
      const missing = await usage({ report_key: "resp_1", usage: quantities }, "session-none");

      expect(sessions.rows.get("session-1")).toMatchObject({
        kind: "realtime",
        metering: "gateway",
        transcriptionModel: "elevenlabs/scribe_v1",
      });
      expect(sessions.rows.get("session-1")?.credentialExpiresAt?.epochMilliseconds).toBe(
        credentialExpiresAt,
      );
      expect(recorded).toEqual({
        status: 200,
        body: {
          session_id: "session-1",
          status: "recorded",
          cost_nano_usd: cost,
          session_cost_nano_usd: cost,
          // No budget read is composed on this door, so the verdict is unknown.
          budget: { exceeded: false, unknown: true },
        },
      });
      expect(again.body).toMatchObject({
        status: "duplicate",
        cost_nano_usd: 0,
        session_cost_nano_usd: cost,
      });
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ error: { code: "realtime_session_not_found" } });
    });

    it("prices a transcription report under the session's transcription model", async () => {
      const { spend, reserve, usage } = door();
      await reserve({ kind: "realtime", transcription_model: "elevenlabs/scribe_v1" });

      await usage({ report_key: "item_1", priced_as: "transcription", usage: { audio_ms: 2000 } });

      expect(spend.sent[0]).toMatchObject({
        gateway_request_id: "session-1.item_1",
        model: "elevenlabs/scribe_v1",
        request_type: "realtime_response",
      });
    });

    it("closes the session on a final report and answers already closed afterwards", async () => {
      const { sessions, reserve, usage } = door();
      await reserve({ kind: "realtime", metering: "gateway" });

      const closed = await usage({ final: true, duration_ms: 42_000 });
      const late = await usage({ report_key: "resp_9", usage: { input_tokens: 5 } });

      expect(closed.body).toMatchObject({ status: "closed", cost_nano_usd: 0 });
      expect(late.body).toMatchObject({ status: "already_closed", cost_nano_usd: 0 });
      expect(sessions.rows.get("session-1")?.status).toBe("CLOSED");
    });

    it("refuses a report that carries neither usage nor final", async () => {
      const { reserve, usage } = door();
      await reserve();

      const refused = await usage({ report_key: "resp_1" });

      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ error: { code: "invalid_usage_report" } });
    });
  });

  describe("when the gateway sends only the fields an older build sends", () => {
    /** @scenario "A gateway that sends none of the new fields still books and closes a session" */
    it("books a session with no kind and closes it on the single report", async () => {
      const { sessions, spend, reserve, usage } = door();

      const booked = await reserve();
      const closed = await usage({ usage: { input_tokens: 10, output_tokens: 5 } });

      expect(booked).toEqual({ status: 200, body: { session_id: "session-1", status: "OPEN" } });
      expect(closed.body).toMatchObject({ session_id: "session-1", status: "closed" });
      expect(sessions.rows.get("session-1")).toMatchObject({
        kind: null,
        metering: null,
        status: "CLOSED",
      });
      expect(spend.sent.map((sent) => sent.gateway_request_id)).toEqual(["session-1"]);
    });
  });

  describe("when a patch carries only the credential's expiry", () => {
    /** @scenario "A credential expiry can be recorded on its own" */
    it("records it and leaves the session open", async () => {
      const { sessions, send, reserve } = door();
      await reserve();

      const patched = await send({
        method: "PATCH",
        path: `${SESSIONS_PATH}/session-1`,
        body: { project_id: "project-1", credential_expires_at: 1_800_000_900_000 },
      });

      expect(patched).toEqual({ status: 200, body: { session_id: "session-1", updated: true } });
      const row = sessions.rows.get("session-1");
      expect(row?.credentialExpiresAt?.epochMilliseconds).toBe(1_800_000_900_000);
      expect(row?.status).toBe("OPEN");
    });
  });
});
