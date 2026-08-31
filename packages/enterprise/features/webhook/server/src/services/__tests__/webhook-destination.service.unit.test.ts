/**
 * What a webhook is allowed to deliver to.
 *
 * This is the admission gate for a customer-supplied destination, and the same
 * policy the sender enforces at dispatch — so an endpoint that saves is one
 * that can deliver. Everything it refuses, it refuses for a reason worth
 * writing down: credentials in a URL would be stored and replayed on every
 * send, a plain-http destination would carry signed payloads in the clear, and
 * a queue URL that is not actually Amazon's is a destination pointed somewhere
 * nobody audited.
 */

import { describe, expect, it } from "vitest";
import { WebhookDestinationService } from "../webhook-destination.service";

const destinations = WebhookDestinationService.create();

describe("WebhookDestinationService", () => {
  describe("given an HTTP destination", () => {
    describe("when it is an ordinary https endpoint", () => {
      it("admits it", () => {
        expect(destinations.tryInspectUrl("https://example.test/hook", false)).toBeNull();
      });
    });

    describe("when it carries credentials in the URL", () => {
      it("refuses it, because those would be stored and replayed on every send", () => {
        expect(destinations.tryInspectUrl("https://user:pass@example.test/hook", false)).toBe(
          "credentials",
        );
      });

      it("refuses it even where local destinations are allowed", () => {
        // The operator opt-in relaxes the origin, never the credential rule —
        // the check runs ahead of the scheme and port checks for that reason.
        expect(destinations.tryInspectUrl("http://user:pass@localhost/hook", true)).toBe(
          "credentials",
        );
      });
    });

    describe("when it is not https", () => {
      it("refuses it by default", () => {
        expect(destinations.tryInspectUrl("http://example.test/hook", false)).toBe("scheme");
      });

      it("admits it once an operator has opted into local destinations", () => {
        expect(destinations.tryInspectUrl("http://localhost:3000/hook", true)).toBeNull();
      });
    });

    describe("when it names a port other than 443", () => {
      it("refuses it by default", () => {
        expect(destinations.tryInspectUrl("https://example.test:8443/hook", false)).toBe("port");
      });

      it("admits 443 written out", () => {
        expect(destinations.tryInspectUrl("https://example.test:443/hook", false)).toBeNull();
      });
    });

    describe("when it is not a URL at all", () => {
      it("says so rather than throwing", () => {
        expect(destinations.tryInspectUrl("not a url", false)).toBe("invalid_url");
      });
    });
  });

  describe("given an SQS queue URL", () => {
    describe("when it is the regional form", () => {
      it("accepts it and reads back its region, account and name", () => {
        const result = destinations.inspectSqsQueueUrl(
          "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries",
        );

        expect(result).toEqual({
          ok: true,
          parsed: {
            queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries",
            region: "eu-west-1",
            accountId: "123456789012",
            queueName: "deliveries",
          },
        });
      });
    });

    describe("when it is the legacy per-region host form", () => {
      it("accepts that too", () => {
        const result = destinations.inspectSqsQueueUrl(
          "https://eu-west-1.queue.amazonaws.com/123456789012/deliveries",
        );

        expect(result.ok).toBe(true);
      });
    });

    describe("when it is surrounded by whitespace", () => {
      it("trims before matching, and stores the trimmed form", () => {
        const result = destinations.inspectSqsQueueUrl(
          "  https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries  ",
        );

        expect(result).toMatchObject({
          ok: true,
          parsed: { queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries" },
        });
      });
    });

    describe("when it is a FIFO queue", () => {
      it("refuses it as such, rather than as a malformed URL", () => {
        const result = destinations.inspectSqsQueueUrl(
          "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries.fifo",
        );

        expect(result).toEqual({ ok: false, problem: "fifo" });
      });
    });

    describe("when the host is not Amazon's", () => {
      it("refuses it, so a queue URL cannot point at somebody else's server", () => {
        const result = destinations.inspectSqsQueueUrl(
          "https://sqs.eu-west-1.amazonaws.com.evil.test/123456789012/deliveries",
        );

        expect(result).toEqual({ ok: false, problem: "shape" });
      });
    });

    describe("when the account is not twelve digits", () => {
      it("refuses it", () => {
        expect(
          destinations.inspectSqsQueueUrl("https://sqs.eu-west-1.amazonaws.com/12345/deliveries"),
        ).toEqual({ ok: false, problem: "shape" });
      });
    });

    describe("when it is served over plain http", () => {
      it("refuses it", () => {
        expect(
          destinations.inspectSqsQueueUrl(
            "http://sqs.eu-west-1.amazonaws.com/123456789012/deliveries",
          ),
        ).toEqual({ ok: false, problem: "shape" });
      });
    });
  });

  describe("given a role ARN", () => {
    describe("when it names an IAM role", () => {
      it("accepts it, in the commercial and the partitioned forms", () => {
        expect(destinations.isRoleArn("arn:aws:iam::123456789012:role/deliver")).toBe(true);
        expect(destinations.isRoleArn("arn:aws-cn:iam::123456789012:role/deliver")).toBe(true);
        expect(destinations.isRoleArn("arn:aws-us-gov:iam::123456789012:role/deliver")).toBe(true);
      });
    });

    describe("when it names something other than a role", () => {
      it("refuses it", () => {
        expect(destinations.isRoleArn("arn:aws:iam::123456789012:user/someone")).toBe(false);
        expect(destinations.isRoleArn("not an arn")).toBe(false);
      });
    });
  });

  describe("given a queue's credentials", () => {
    describe("when a role is present", () => {
      it("reports assume-role, which wins over any static key", () => {
        expect(destinations.sqsCredentialMode({ roleArn: "arn:...", accessKeyId: "AKIA..." })).toBe(
          "assume_role",
        );
      });
    });

    describe("when only a static key is present", () => {
      it("reports static", () => {
        expect(destinations.sqsCredentialMode({ roleArn: null, accessKeyId: "AKIA..." })).toBe(
          "static",
        );
      });
    });

    describe("when neither is present", () => {
      it("reports ambient, meaning the process's own credentials", () => {
        expect(destinations.sqsCredentialMode({ roleArn: null, accessKeyId: null })).toBe(
          "ambient",
        );
      });
    });
  });
});
