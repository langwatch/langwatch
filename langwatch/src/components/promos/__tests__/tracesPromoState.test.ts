/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildTraceExplorerEarlyAccessMailto,
	isPromoSnoozed,
	openCrispChat,
	snoozePromo,
	TRACE_PROMO_SNOOZE_DAYS,
	type TracesPromoSnoozeStore,
} from "../tracesPromoState";

const STORE: TracesPromoSnoozeStore = { prefix: "test:promo:v1:" };

describe("tracesPromoState", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete (window as unknown as { $crisp?: unknown }).$crisp;
	});

	describe("snoozePromo + isPromoSnoozed", () => {
		describe("given a fresh project", () => {
			it("reports not snoozed", () => {
				expect(isPromoSnoozed(STORE, "proj-1", "try")).toBe(false);
			});
		});

		describe("when a project has been snoozed", () => {
			it("reports snoozed for the same project + mode", () => {
				snoozePromo(STORE, "proj-1", "try");
				expect(isPromoSnoozed(STORE, "proj-1", "try")).toBe(true);
			});

			it("does not affect a different mode for the same project", () => {
				snoozePromo(STORE, "proj-1", "try");
				expect(isPromoSnoozed(STORE, "proj-1", "request")).toBe(false);
			});

			it("does not affect a different project", () => {
				snoozePromo(STORE, "proj-1", "try");
				expect(isPromoSnoozed(STORE, "proj-2", "try")).toBe(false);
			});

			it("does not affect a store with a different prefix", () => {
				snoozePromo(STORE, "proj-1", "try");
				expect(
					isPromoSnoozed({ prefix: "other:" }, "proj-1", "try"),
				).toBe(false);
			});

			it("expires after the snooze window", () => {
				snoozePromo(STORE, "proj-1", "try");
				expect(isPromoSnoozed(STORE, "proj-1", "try")).toBe(true);

				const beyondWindow =
					(TRACE_PROMO_SNOOZE_DAYS + 1) * 24 * 60 * 60 * 1000;
				vi.advanceTimersByTime(beyondWindow);
				expect(isPromoSnoozed(STORE, "proj-1", "try")).toBe(false);
			});
		});

		describe("when localStorage holds a non-numeric expiry", () => {
			it("treats the entry as not snoozed (corrupt-state recovery)", () => {
				localStorage.setItem(`${STORE.prefix}try:proj-1`, "not-a-number");
				expect(isPromoSnoozed(STORE, "proj-1", "try")).toBe(false);
			});
		});
	});

	describe("openCrispChat", () => {
		describe("when Crisp is not installed on the page", () => {
			it("returns false", () => {
				expect(openCrispChat()).toBe(false);
			});
		});

		describe("when Crisp is installed", () => {
			it("opens the chat and returns true", () => {
				const push = vi.fn();
				(window as unknown as { $crisp: { push: typeof push } }).$crisp = {
					push,
				};

				expect(openCrispChat()).toBe(true);
				expect(push).toHaveBeenCalledWith(["do", "chat:show"]);
				expect(push).toHaveBeenCalledWith(["do", "chat:toggle"]);
			});
		});
	});

	describe("buildTraceExplorerEarlyAccessMailto", () => {
		describe("when a project slug is provided", () => {
			it("includes the slug inside the body", () => {
				const url = buildTraceExplorerEarlyAccessMailto("acme-prod");
				expect(url).toContain(
					"subject=Early%20access%20to%20the%20new%20Trace%20Explorer",
				);
				expect(url).toContain("acme-prod");
			});
		});

		describe("when slug is undefined", () => {
			it("omits the project clause from the body", () => {
				const url = buildTraceExplorerEarlyAccessMailto(undefined);
				expect(url).not.toContain("project");
			});
		});
	});
});
