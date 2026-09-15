import { describe, expect, it } from "vitest";
import type { GovernanceConfig } from "../config";
import {
	SOURCE_TYPE_BY_TOOL,
	buildOtelEnvBlock,
	exportsTelemetry,
	instrumentableTools,
	telemetryEnvVarNames,
} from "../otel-env-block";
import { envForTool } from "../tool-env";

const ENDPOINT = "https://app.langwatch.test/api/otel";
const TOKEN = "ik-lw-PI-SECRET-DO-NOT-LEAK";
const VIRTUAL_KEY = "vk-lw-PI-SECRET-DO-NOT-LEAK";

describe("pi receives no OTel env block", () => {
	// @scenario "The pi child process is handed no telemetry credentials"
	it("hands pi's child nothing at all", () => {
		expect(buildOtelEnvBlock("pi", ENDPOINT, TOKEN)).toEqual({});
	});

	it("leaks neither the endpoint nor the token in any value", () => {
		const serialised = JSON.stringify(
			buildOtelEnvBlock("pi", ENDPOINT, TOKEN),
		);
		expect(serialised).not.toContain(TOKEN);
		expect(serialised).not.toContain(ENDPOINT);
	});

	// The bug this guards was pi silently taking the `default` branch, which is
	// what an unknown/typo'd slug gets. pi must be distinguishable from that.
	it("differs from an unknown tool, which still gets the generic block", () => {
		const unknown = buildOtelEnvBlock("cursor-typo", ENDPOINT, TOKEN);
		expect(Object.keys(unknown)).toEqual([
			"OTEL_EXPORTER_OTLP_ENDPOINT",
			"OTEL_EXPORTER_OTLP_HEADERS",
		]);
		expect(buildOtelEnvBlock("pi", ENDPOINT, TOKEN)).not.toEqual(unknown);
	});

	it("keeps a real exporter's block intact", () => {
		const codex = buildOtelEnvBlock("codex", ENDPOINT, TOKEN);
		expect(Object.keys(codex).length).toBeGreaterThan(2);
		expect(codex.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(ENDPOINT);
	});

	it("still has a mint slug, which is the only reason pi is in the table", () => {
		expect(SOURCE_TYPE_BY_TOOL.pi).toBe("pi");
	});
});

describe("instrument rejects tools that export nothing", () => {
	// @scenario "A tool that ships no exporter cannot be instrumented"
	it("does not offer pi as instrumentable", () => {
		expect(exportsTelemetry("pi")).toBe(false);
		expect(instrumentableTools()).not.toContain("pi");
	});

	it("still offers every tool that does export", () => {
		for (const tool of ["claude", "codex", "gemini", "opencode", "copilot"]) {
			expect(exportsTelemetry(tool)).toBe(true);
			expect(instrumentableTools()).toContain(tool);
		}
	});

	// The removal sweep derives its key list from the same builder. pi returning
	// {} must not shorten the keys any real tool's logout path strips.
	it("leaves the sweep key sets of the tools that use it untouched", () => {
		expect(telemetryEnvVarNames("claude").length).toBeGreaterThan(2);
		expect(telemetryEnvVarNames("copilot").length).toBeGreaterThan(2);
		expect(telemetryEnvVarNames("pi")).toEqual([]);
	});
});

/**
 * The gateway half of the same guarantee. This is a credential-exposure test,
 * not a capture one: `envForTool`'s gateway block sets OPENAI_API_KEY to the
 * user's LangWatch virtual key, on the premise that the paired base URL points
 * the tool at our gateway. pi ignores that base URL — every catalog model's
 * address is fixed in pi's own build — so a pi entry here shipped our virtual
 * key straight to api.openai.com, which echoed it back in the 401 body. pi's
 * platform policy (allowVk:false) keeps the wrapper out of gateway mode, and
 * this keeps the env shape gone underneath it, so flipping the policy back
 * cannot revive the leak. ADR-132 §7.
 */
describe("pi receives no gateway env block", () => {
	const cfg = {
		gateway_url: "https://gw.langwatch.test",
		control_plane_url: "https://app.langwatch.test",
		access_token: "tok",
		default_personal_vk: { id: "vk1", secret: VIRTUAL_KEY },
	} as GovernanceConfig;

	it("hands pi's child no base URL and no key", () => {
		expect(envForTool(cfg, "pi").vars).toEqual({});
	});

	it("never puts the virtual key anywhere in pi's env", () => {
		expect(JSON.stringify(envForTool(cfg, "pi"))).not.toContain(VIRTUAL_KEY);
	});

	// The control: a tool that really does honour the swap still gets it, so
	// this cannot pass because the config or the builder is broken.
	it("keeps the gateway block intact for a tool that honours the swap", () => {
		const claude = envForTool(cfg, "claude").vars;
		expect(claude.ANTHROPIC_BASE_URL).toBe("https://gw.langwatch.test");
		expect(claude.ANTHROPIC_AUTH_TOKEN).toBe(VIRTUAL_KEY);
	});
});
