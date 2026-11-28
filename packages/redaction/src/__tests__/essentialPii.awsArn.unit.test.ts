import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii.ts";

describe("redactEssentialPiiInText", () => {
  describe("when the text holds an AWS ARN", () => {
    it.each([
      "arn:aws:iam::123456789012:role/traced-agent",
      "arn:aws:sts::123456789012:assumed-role/traced-agent/session-1",
      "arn:aws-us-gov:iam::123456789012:role/agent",
      "arn:aws:s3:::acme-bucket/key",
    ])("keeps %s as an attribute value", (arn) => {
      expect(redactEssentialPiiInText({ text: arn, isAttributeValue: true })).toEqual({
        text: arn,
        redactedCount: 0,
      });
    });

    it("keeps the ARN in free text and still masks a real IPv6 address beside it", () => {
      const text = "caller arn:aws:iam::123456789012:role/agent from 2001:db8::1";
      expect(redactEssentialPiiInText({ text }).text).toBe(
        "caller arn:aws:iam::123456789012:role/agent from [IP_ADDRESS]",
      );
    });

    it("still masks an email inside an assumed-role session name", () => {
      const text = "arn:aws:sts::123456789012:assumed-role/agent/jane@example.com";
      expect(redactEssentialPiiInText({ text }).text).not.toContain("jane@example.com");
    });

    it.each([
      ["an IPv4 address", "arn:aws:s3:::audit/203.0.113.5", "arn:aws:s3:::audit/[IP_ADDRESS]"],
      ["an IPv6 address", "arn:aws:s3:::audit/2001:db8::1", "arn:aws:s3:::audit/[IP_ADDRESS]"],
    ])("still masks %s in the ARN's resource path", (_, text, expected) => {
      expect(redactEssentialPiiInText({ text }).text).toBe(expected);
    });

    it("masks an IP in the next key=value pair after an ARN", () => {
      const text = "principal=arn:aws:iam::123456789012:role/r,client_ip=203.0.113.5";
      expect(redactEssentialPiiInText({ text }).text).toBe(
        "principal=arn:aws:iam::123456789012:role/r,client_ip=[IP_ADDRESS]",
      );
    });
  });
});
