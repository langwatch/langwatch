/**
 * The device label rides on server-minted credentials (personal VKs,
 * project ingest keys) so an admin revoking one can tell which machine
 * it belongs to. It must stay server-safe: lowercase [a-z0-9-], short,
 * and free of the raw hostname's noise (mDNS suffixes, underscores).
 */
import type * as osType from "node:os";

import { describe, expect, it, vi } from "vitest";

import { deviceLabelForThisMachine } from "../device-label";

const hostname = vi.hoisted(() => ({ value: "host" }));

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof osType>();
	return { ...actual, hostname: () => hostname.value };
});

describe("deviceLabelForThisMachine", () => {
	describe("when the hostname carries an mDNS suffix", () => {
		it("lowercases the name and strips the .local suffix", () => {
			hostname.value = "Rogerios-MacBook-Pro.local";
			expect(deviceLabelForThisMachine()).toBe("rogerios-macbook-pro");
		});
	});

	describe("when the hostname carries characters outside [a-z0-9-]", () => {
		it("collapses them to single dashes", () => {
			hostname.value = "vps_01.example.com";
			expect(deviceLabelForThisMachine()).toBe("vps-01-example-com");
		});
	});

	describe("when the hostname is longer than 24 characters", () => {
		it("truncates to 24", () => {
			hostname.value = "a-very-long-hostname-that-keeps-going";
			expect(deviceLabelForThisMachine()).toBe("a-very-long-hostname-tha");
		});
	});

	describe("when the hostname yields nothing usable", () => {
		it("returns an empty label", () => {
			hostname.value = "***";
			expect(deviceLabelForThisMachine()).toBe("");
		});
	});
});
