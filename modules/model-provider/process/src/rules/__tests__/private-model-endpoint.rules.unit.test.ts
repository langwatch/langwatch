import { ValidationError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  normalizeBindingHostname,
  normalizeEndpointAddresses,
  normalizeEndpointLabel,
  validateEndpointPort,
} from "../private-model-endpoint.rules.ts";

/** The field errors a refusal carries, or a failure when the call was not refused. */
function fieldErrorsOf(run: () => unknown): Record<string, string[]> {
  let refusal: unknown;
  try {
    run();
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(ValidationError);
  return (refusal as ValidationError).meta?.fieldErrors as Record<string, string[]>;
}

describe("normalizeBindingHostname", () => {
  describe("given a fully qualified hostname", () => {
    it("lowercases it, trims it and drops a trailing dot", () => {
      expect(normalizeBindingHostname("  LLM.Internal.Acme.test. ")).toBe("llm.internal.acme.test");
    });
  });

  describe("given a hostname a binding may not name", () => {
    /** @scenario "An invalid hostname is refused" */
    it.each([
      ["10.20.1.21", "not an IP address"],
      ["[fd00::1]", "not an IP address"],
      ["fd00::1", "not an IP address"],
      ["*.acme.test", "Wildcards"],
      ["localhost", "localhost"],
      ["api.localhost", "localhost"],
      ["acme", "fully qualified"],
      ["", "Enter a hostname"],
      ["llm_acme.test", "valid hostname"],
      ["metadata.google.internal", "metadata"],
      ["langwatch.ai", "LangWatch hostname"],
      ["app.langwatch.ai", "LangWatch hostname"],
      ["Gateway.LangWatch.AI.", "LangWatch hostname"],
    ])("refuses %j on the hostname field and says why", (hostname, reason) => {
      const errors = fieldErrorsOf(() => normalizeBindingHostname(hostname));

      expect(errors.hostname?.[0]).toContain(reason);
    });
  });
});

describe("normalizeEndpointAddresses", () => {
  describe("given single private addresses", () => {
    it("keeps each once, trimmed and lowercased", () => {
      expect(
        normalizeEndpointAddresses([" 10.20.1.21", "10.20.1.21", "FD12::5", "172.16.0.9"]),
      ).toEqual(["10.20.1.21", "fd12::5", "172.16.0.9"]);
    });

    /** @scenario "Ops accepts an address in each private range the dial admits" */
    it("accepts every private range the dial gate admits", () => {
      const addresses = [
        "10.0.0.1",
        "172.31.255.254",
        "192.168.1.1",
        "100.64.0.1",
        "100.127.255.254",
        "fd00::1",
      ];

      expect(normalizeEndpointAddresses(addresses)).toEqual(addresses);
    });
  });

  describe("given an address staff may not register", () => {
    /** @scenario "Ops refuses an invalid address or port" */
    it.each([
      ["10.20.1.0/24", "range"],
      ["8.8.8.8", "not a private address"],
      ["127.0.0.1", "not a private address"],
      ["::1", "not a private address"],
      ["169.254.169.254", "metadata"],
      ["fd00:ec2::254", "metadata"],
      ["172.32.0.1", "not a private address"],
      ["100.63.255.255", "not a private address"],
      ["100.128.0.1", "not a private address"],
      ["llm.acme.test", "not an IP address"],
    ])("refuses %j on the addresses field", (address, reason) => {
      const errors = fieldErrorsOf(() => normalizeEndpointAddresses(["10.20.1.21", address]));

      expect(errors.addresses?.[0]).toContain(reason);
    });

    it("refuses an empty list", () => {
      expect(fieldErrorsOf(() => normalizeEndpointAddresses([" "])).addresses).toBeDefined();
    });

    it("refuses more than sixteen addresses", () => {
      const many = Array.from({ length: 17 }, (_, index) => `10.0.0.${index + 1}`);

      expect(fieldErrorsOf(() => normalizeEndpointAddresses(many)).addresses).toBeDefined();
    });
  });
});

describe("validateEndpointPort", () => {
  describe("given a port from 1 to 65535", () => {
    it("keeps it", () => {
      expect(validateEndpointPort(1)).toBe(1);
      expect(validateEndpointPort(443)).toBe(443);
      expect(validateEndpointPort(65_535)).toBe(65_535);
    });
  });

  describe("given a port outside that range", () => {
    /** @scenario "Ops refuses an invalid address or port" */
    it.each([0, 70_000, -1, 443.5])("refuses %j on the port field", (port) => {
      expect(fieldErrorsOf(() => validateEndpointPort(port)).port).toBeDefined();
    });
  });
});

describe("normalizeEndpointLabel", () => {
  describe("given a blank or overlong value", () => {
    it("refuses it on its own field", () => {
      expect(
        fieldErrorsOf(() => normalizeEndpointLabel({ field: "name", value: " " })).name,
      ).toBeDefined();
      expect(
        fieldErrorsOf(() => normalizeEndpointLabel({ field: "region", value: "x".repeat(121) }))
          .region,
      ).toBeDefined();
    });
  });
});
