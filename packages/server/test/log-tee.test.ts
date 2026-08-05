import { describe, expect, it } from "vitest";
import { renderEvent } from "../src/animation/log-tee.ts";

describe("renderEvent", () => {
	describe("when given a starting event", () => {
		it("paints with a 'starting…' suffix", () => {
			const out = renderEvent({ type: "starting", service: "postgres" });
			expect(out).not.toBeNull();
			expect(out).toContain("postgres");
			expect(out).toContain("starting");
		});
	});

	describe("when given a healthy event", () => {
		it("paints with the duration in ms", () => {
			const out = renderEvent({
				type: "healthy",
				service: "redis",
				durationMs: 1234,
			});
			expect(out).toContain("redis");
			expect(out).toContain("1234ms");
		});
	});

	describe("when given a log event", () => {
		it("strips trailing newlines so listr lines never double-spaced", () => {
			const out = renderEvent({
				type: "log",
				service: "langwatch",
				stream: "stdout",
				line: "Listening on :5560\n",
			});
			expect(out).toContain("langwatch");
			expect(out).toContain("Listening on :5560");
			expect(out).not.toContain("\n\n");
		});
	});

	describe("when given a restarting event", () => {
		it("announces the exit cause, the delay, and the attempt budget", () => {
			const out = renderEvent({
				type: "restarting",
				service: "workers",
				code: 137,
				attempt: 1,
				maxAttempts: 3,
				delayMs: 1000,
			});
			expect(out).toContain("workers");
			expect(out).toContain("exited (code 137)");
			expect(out).toContain("restarting in 1s");
			expect(out).toContain("(attempt 1/3)");
		});

		it("names the signal when the child was killed rather than exiting", () => {
			const out = renderEvent({
				type: "restarting",
				service: "workers",
				code: -1,
				signal: "SIGKILL",
				attempt: 2,
				maxAttempts: 3,
				delayMs: 5000,
			});
			expect(out).toContain("exited (signal SIGKILL)");
			expect(out).toContain("(attempt 2/3)");
		});
	});

	describe("when given a crashed event", () => {
		it("paints in red with the exit code", () => {
			const out = renderEvent({
				type: "crashed",
				service: "clickhouse",
				code: 137,
			});
			expect(out).toContain("clickhouse");
			expect(out).toContain("137");
			expect(out).toMatch(/crashed/);
		});

		it("points at the service's log file", () => {
			const out = renderEvent({
				type: "crashed",
				service: "clickhouse",
				code: 137,
			});
			expect(out).toContain("clickhouse.log");
			expect(out).toContain("see ");
		});

		it("names the signal when the child was killed rather than exiting", () => {
			const out = renderEvent({
				type: "crashed",
				service: "clickhouse",
				code: -1,
				signal: "SIGKILL",
			});
			expect(out).toContain("crashed (signal SIGKILL)");
			expect(out).not.toContain("exit -1");
		});
	});

	describe("when given a stopped event", () => {
		it("paints with the power-off glyph", () => {
			const out = renderEvent({ type: "stopped", service: "aigateway" });
			expect(out).toContain("aigateway");
			expect(out).toContain("stopped");
		});
	});
});
