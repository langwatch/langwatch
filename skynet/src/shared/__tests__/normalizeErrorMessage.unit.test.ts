import { describe, expect, it } from "vitest";
import { normalizeErrorMessage } from "../normalizeErrorMessage.ts";

describe("normalizeErrorMessage", () => {
  describe("when message contains a UUID", () => {
    it("replaces lowercase UUIDs with <UUID>", () => {
      const msg = "Failed to process 550e8400-e29b-41d4-a716-446655440000";
      expect(normalizeErrorMessage(msg)).toBe("Failed to process <UUID>");
    });

    it("replaces uppercase UUIDs with <UUID>", () => {
      const msg = "Error for ID 550E8400-E29B-41D4-A716-446655440000";
      expect(normalizeErrorMessage(msg)).toBe("Error for ID <UUID>");
    });
  });

  describe("when message contains an IP address", () => {
    it("replaces IPs with <IP>", () => {
      const msg = "Connection refused to 192.168.1.100";
      expect(normalizeErrorMessage(msg)).toBe("Connection refused to <IP>");
    });

    it("replaces IP with port together", () => {
      const msg = "Cannot reach 10.0.0.1:3000";
      expect(normalizeErrorMessage(msg)).toBe("Cannot reach <IP>:<PORT>");
    });
  });

  describe("when message contains a port number", () => {
    it("replaces ports with :<PORT>", () => {
      const msg = "Cannot connect to host:5432";
      expect(normalizeErrorMessage(msg)).toBe("Cannot connect to host:<PORT>");
    });
  });

  describe("when message contains a large numeric ID", () => {
    it("replaces 10+ digit numbers with <ID>", () => {
      const msg = "Record 1234567890 not found";
      expect(normalizeErrorMessage(msg)).toBe("Record <ID> not found");
    });

    it("does not replace numbers shorter than 10 digits", () => {
      const msg = "Error code 123456789";
      expect(normalizeErrorMessage(msg)).toBe("Error code 123456789");
    });
  });

  describe("when message contains excess whitespace", () => {
    it("collapses whitespace and trims", () => {
      const msg = "  too   many    spaces  ";
      expect(normalizeErrorMessage(msg)).toBe("too many spaces");
    });
  });

  describe("when message contains all volatile token types", () => {
    it("replaces all tokens in a single pass", () => {
      const msg =
        "Host 10.0.0.1:8080 returned error for 550e8400-e29b-41d4-a716-446655440000  request  1234567890123";
      expect(normalizeErrorMessage(msg)).toBe(
        "Host <IP>:<PORT> returned error for <UUID> request <ID>"
      );
    });
  });

  describe("when message is empty", () => {
    it("returns empty string", () => {
      expect(normalizeErrorMessage("")).toBe("");
    });
  });

  describe("when message has no volatile tokens", () => {
    it("preserves normal text unchanged", () => {
      const msg = "Something went wrong";
      expect(normalizeErrorMessage(msg)).toBe("Something went wrong");
    });
  });
});
