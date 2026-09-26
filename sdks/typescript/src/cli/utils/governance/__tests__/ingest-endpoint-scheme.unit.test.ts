/**
 * Which ingest endpoints send the key in the clear.
 *
 * The distinction the warning rests on is loopback against everything else, so
 * the spellings of loopback are what this pins: the ones a person types, the
 * `.localhost` names the local dev proxy hands out, and the IPv4-mapped IPv6
 * form `new URL()` normalises a bracketed loopback address into.
 *
 * Feature: specs/ai-governance/cli-wrappers/instrument-command.feature
 */

import { describe, expect, it } from "vitest";

import {
	cleartextIngestEndpointWarning,
	sendsIngestKeyInClear,
} from "../ingest-endpoint-scheme";

describe("sendsIngestKeyInClear", () => {
	describe("given plain http to another host", () => {
		it("reports every one of them", () => {
			for (const endpoint of [
				"http://lw.acme.dev/api/otel",
				"http://10.0.0.7:5570/api/otel",
				"http://collector.internal/api/otel",
				"http://[2001:db8::1]/api/otel",
			]) {
				expect(sendsIngestKeyInClear(endpoint)).toBe(true);
			}
		});
	});

	describe("given https", () => {
		it("reports none of them, whatever the host", () => {
			for (const endpoint of [
				"https://app.langwatch.ai/api/otel",
				"https://lw.acme.dev/api/otel",
				"https://localhost:5570/api/otel",
			]) {
				expect(sendsIngestKeyInClear(endpoint)).toBe(false);
			}
		});
	});

	describe("given http to loopback", () => {
		it("reports none of them, since the key never leaves the machine", () => {
			for (const endpoint of [
				"http://localhost:5570/api/otel",
				"http://127.0.0.1/api/otel",
				"http://127.0.0.5:8124/api/otel",
				"http://[::1]:5570/api/otel",
				"http://[::ffff:127.0.0.1]/api/otel",
				// The local dev proxy's names; RFC 6761 reserves .localhost for
				// loopback, and a worktree stack is reached at one of these.
				"http://app.portless.langwatch.localhost/api/otel",
			]) {
				expect(sendsIngestKeyInClear(endpoint)).toBe(false);
			}
		});
	});

	describe("given nothing usable", () => {
		it("reports nothing, rather than warning about a URL it could not read", () => {
			for (const endpoint of [undefined, "", "   ", "not a url", "app.acme.dev"]) {
				expect(sendsIngestKeyInClear(endpoint)).toBe(false);
			}
		});
	});
});

describe("cleartextIngestEndpointWarning", () => {
	it("names the host and the endpoint, and points at https", () => {
		const warning = cleartextIngestEndpointWarning("http://lw.acme.dev/api/otel");

		expect(warning).toContain("lw.acme.dev");
		expect(warning).toContain("http://lw.acme.dev/api/otel");
		expect(warning).toContain("https");
		// Never phrased as a refusal: the command continues after saying it.
		expect(warning).not.toMatch(/refus|blocked|abort/i);
	});
});
