/**
 * otelWiringLooksLangwatchAuthored — the authorship guard shared by every
 * latest-login-wins (#6202) refresh and removal path. A langwatch-shaped
 * ingest-key bearer or /api/otel endpoint marks an unmarked env block as
 * ours to refresh; anything else (a user's own OTLP collector, or no
 * identity-bearing key at all) must never be touched.
 */
import { describe, expect, it } from "vitest";

import { otelWiringLooksLangwatchAuthored } from "../telemetry-refresh";

describe("otelWiringLooksLangwatchAuthored", () => {
	describe("when the env carries a langwatch ingest-key bearer", () => {
		it("treats ik-lw- and sk-lw- bearers as langwatch-authored", () => {
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_HEADERS:
						"Authorization=Bearer ik-lw-stalelogin000000_oldsecret",
				}),
			).toBe(true);
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-legacy",
				}),
			).toBe(true);
		});
	});

	describe("when the env carries a langwatch OTLP endpoint", () => {
		it("treats an /api/otel endpoint as langwatch-authored", () => {
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_ENDPOINT: "https://app.langwatch.ai/api/otel",
				}),
			).toBe(true);
		});
	});

	describe("when the env points at a third-party collector", () => {
		it("refuses both a foreign endpoint and a foreign bearer", () => {
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
					OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
				}),
			).toBe(false);
		});
	});

	describe("when no identity-bearing key is present", () => {
		it("treats the env as refreshable", () => {
			expect(
				otelWiringLooksLangwatchAuthored({ CLAUDE_CODE_ENABLE_TELEMETRY: "1" }),
			).toBe(true);
		});
	});
});
