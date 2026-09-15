/**
 * The device label a CLI device session is known by on its ApiKey rows. One
 * derivation serves the login key and every ingest key minted under it.
 * Spec: modules/api-key/specs/api-key.feature
 */
import { describe, expect, it } from "vitest";
import {
  CLI_LOGIN_UNKNOWN_DEVICE_LABEL,
  deviceLabelForSession,
  sanitizeDeviceLabel,
} from "../api-key.device-label.ts";

describe("sanitizeDeviceLabel", () => {
  describe("given a raw label with characters a key name cannot carry", () => {
    /** @scenario "A device label is reduced to the charset a key name carries" */
    it("lowercases and collapses everything outside a-z0-9- into single dashes", () => {
      expect(sanitizeDeviceLabel("Rogerio's MacBook Pro!!")).toBe("rogerio-s-macbook-pro");
    });

    it("trims to 24 characters", () => {
      expect(sanitizeDeviceLabel("a".repeat(40))).toBe("a".repeat(24));
    });

    it("strips leading and trailing dashes left by the collapse", () => {
      expect(sanitizeDeviceLabel("!!!laptop!!!")).toBe("laptop");
    });
  });

  describe("given nothing usable", () => {
    it("returns null for an empty string", () => {
      expect(sanitizeDeviceLabel("")).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(sanitizeDeviceLabel(void 0)).toBeNull();
    });

    it("returns null when only unsupported characters were given", () => {
      expect(sanitizeDeviceLabel("!!!")).toBeNull();
    });
  });
});

describe("deviceLabelForSession", () => {
  describe("given both a chosen label and a hostname", () => {
    it("prefers the user-chosen label", () => {
      expect(
        deviceLabelForSession({ device_label: "work-laptop", hostname: "some-host" }),
      ).toBe("work-laptop");
    });
  });

  describe("given only a hostname", () => {
    it("falls back to the normalized hostname", () => {
      expect(deviceLabelForSession({ hostname: "Rogerios-MacBook.local" })).toBe(
        "rogerios-macbook-local",
      );
    });
  });

  describe("given neither", () => {
    /** @scenario "A session with neither a chosen label nor a hostname is unknown-device" */
    it("answers the unknown-device marker", () => {
      expect(deviceLabelForSession(undefined)).toBe(CLI_LOGIN_UNKNOWN_DEVICE_LABEL);
      expect(deviceLabelForSession({})).toBe(CLI_LOGIN_UNKNOWN_DEVICE_LABEL);
    });
  });
});
