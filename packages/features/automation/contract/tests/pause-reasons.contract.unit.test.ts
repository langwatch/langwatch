import { describe, expect, it } from "vitest";
import {
	isAutomationPauseReason,
	RUNAWAY_PAUSE_REASON,
} from "../src/index";

describe("automation pause reasons", () => {
	it("recognises only persisted platform pause reasons", () => {
		expect(isAutomationPauseReason(RUNAWAY_PAUSE_REASON)).toBe(true);
		expect(isAutomationPauseReason("customer_paused")).toBe(false);
		expect(isAutomationPauseReason(null)).toBe(false);
	});
});
