import { DispatchError } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertType } from "~/generated/prisma/client";
import type { TriggerData } from "~/runtime/app/features/automation-adapters/trigger.types";
import type { Trace } from "@langwatch/trace-contract";

const { sendEmailMock, computeDefaultFromMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  computeDefaultFromMock: vi.fn(() => "LangWatch <contact@langwatch.ai>"),
}));

vi.mock("../emailSender", () => ({
  sendEmail: sendEmailMock,
  computeDefaultFrom: computeDefaultFromMock,
}));

import { injectFooterIntoBody, sendTriggerEmail } from "../triggerEmail";
import { TEST_FIRE_TRIGGER_ID_SENTINEL } from "../triggerNoReply";
import { TestMailer } from "./mailer.test-double";

const mailer = new TestMailer();

// Both are injected at composition in production (AppConfig.baseHost and the
// mail runtime's NEXTAUTH_SECRET projection), so the tests state them too
// rather than leaning on the process environment.
const BASE_HOST = "https://app.langwatch.test";
const NEXTAUTH_SECRET = "trigger-email-signing-secret";

function callEmailWithDedup(sent: Set<string>, overrides?: { triggerEmails?: string[] }) {
  return sendTriggerEmail({
    mailer,
    triggerEmails: overrides?.triggerEmails ?? ["user@example.com", "other@example.com"],
    triggerData,
    triggerName: "Quality Alert",
    triggerId: "trigger_test123",
    projectId: "project-1",
    projectSlug: "demo",
    triggerType: AlertType.WARNING,
    triggerMessage: "",
    baseHost: BASE_HOST,
    nextauthSecret: NEXTAUTH_SECRET,
    isRecipientSent: async (hash: string) => sent.has(hash),
    recordRecipientSent: async (hash: string) => {
      sent.add(hash);
    },
  });
}

const triggerData: TriggerData[] = [
  {
    input: "in",
    output: "out",
    traceId: "trace-1",
    projectId: "project-1",
    fullTrace: { trace_id: "trace-1" } as unknown as Trace,
  },
];

function callEmail(overrides?: { triggerId?: string }) {
  return sendTriggerEmail({
    mailer,
    triggerEmails: ["user@example.com", "other@example.com"],
    triggerData,
    triggerName: "Quality Alert",
    triggerId: overrides?.triggerId ?? "trigger_test123",
    projectId: "project-1",
    projectSlug: "demo",
    triggerType: AlertType.WARNING,
    triggerMessage: "",
    baseHost: BASE_HOST,
    nextauthSecret: NEXTAUTH_SECRET,
  });
}

describe("injectFooterIntoBody", () => {
  describe("given html with a closing body tag", () => {
    describe("when injecting a footer", () => {
      it("inserts the footer before </body>", () => {
        const result = injectFooterIntoBody(
          "<html><body><p>hi</p></body></html>",
          "<div>footer</div>",
        );
        expect(result).toBe("<html><body><p>hi</p><div>footer</div></body></html>");
      });

      it("matches the closing tag case-insensitively", () => {
        const result = injectFooterIntoBody(
          "<HTML><BODY><p>hi</p></BODY></HTML>",
          "<div>footer</div>",
        );
        // Footer lands before the (case-insensitively matched) closing body tag,
        // never appended after the document.
        expect(result).toMatch(/<p>hi<\/p><div>footer<\/div><\/body><\/HTML>$/i);
        expect(result).not.toMatch(/<\/HTML><div>footer/i);
      });
    });
  });

  describe("given html without a closing body tag", () => {
    describe("when injecting a footer", () => {
      it("appends the footer", () => {
        const result = injectFooterIntoBody("<p>hi</p>", "<div>footer</div>");
        expect(result).toBe("<p>hi</p><div>footer</div>");
      });
    });
  });
});

describe("sendTriggerEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the provider accepts the send", () => {
    it("returns without raising", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await expect(callEmail()).resolves.toBeUndefined();
    });

    it("sends one envelope per recipient with a hashed no-reply To", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail();
      expect(sendEmailMock).toHaveBeenCalledTimes(2);
      const recipients = sendEmailMock.mock.calls.map(
        (c) => (c[0] as { content: { bcc: string[] } }).content.bcc,
      );
      expect(recipients).toEqual([["user@example.com"], ["other@example.com"]]);
      for (const call of sendEmailMock.mock.calls) {
        const args = call[0] as { content: { to: string } };
        expect(args.content.to).toMatch(
          /^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/,
        );
      }
    });

    it("appends an unsubscribe footer and one-click headers per recipient", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail();
      expect(sendEmailMock).toHaveBeenCalledTimes(2);

      const tokens: string[] = [];
      const expectedRecipients = ["user@example.com", "other@example.com"];
      sendEmailMock.mock.calls.forEach((call, i) => {
        const args = call[0] as {
          content: {
            bcc: string[];
            html: string;
            headers: Record<string, string>;
          };
        };
        expect(args.content.bcc).toEqual([expectedRecipients[i]]);
        expect(args.content.html).toContain("Stop receiving this notification");
        expect(args.content.html).toContain("Stop all notifications from this project");
        expect(args.content.html).toContain(`${BASE_HOST}/unsubscribe?token=`);
        expect(args.content.headers["List-Unsubscribe"]).toMatch(/^<.*\/api\/unsubscribe\?token=/);
        expect(args.content.headers["List-Unsubscribe"]).toContain(
          `<${BASE_HOST}/api/unsubscribe?token=`,
        );
        expect(args.content.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
        const match = args.content.headers["List-Unsubscribe"]!.match(/token=([^>&]+)/);
        expect(match).not.toBeNull();
        tokens.push(match![1]!);
      });

      // The HMAC binds each token to its recipient address, so the two
      // recipients must receive distinct unsubscribe tokens.
      expect(tokens[0]).not.toEqual(tokens[1]);
    });

    it("routes one-click List-Unsubscribe to /api/unsubscribe while footer links stay on /unsubscribe", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail();

      for (const call of sendEmailMock.mock.calls) {
        const args = call[0] as {
          content: { html: string; headers: Record<string, string> };
        };
        // RFC 8058: the machine-readable POST endpoint is /api/unsubscribe
        expect(args.content.headers["List-Unsubscribe"]).toMatch(
          /^<[^>]*\/api\/unsubscribe\?token=/,
        );
        // Human-readable footer link remains on the page route /unsubscribe
        expect(args.content.html).toContain("/unsubscribe?token=");
        // Footer must NOT point at the API endpoint
        expect(args.content.html).not.toContain("/api/unsubscribe");
      }
    });

    describe("when the rendered html is a full document", () => {
      it("injects the footer inside the body, not after </body>", async () => {
        sendEmailMock.mockResolvedValue(undefined);
        await callEmail();
        const args = sendEmailMock.mock.calls[0]![0] as { content: { html: string } };
        if (/<\/body>/i.test(args.content.html)) {
          const footerIdx = args.content.html.indexOf("Stop receiving this notification");
          const bodyCloseIdx = args.content.html.search(/<\/body>/i);
          expect(footerIdx).toBeGreaterThanOrEqual(0);
          expect(footerIdx).toBeLessThan(bodyCloseIdx);
        }
      });
    });

    it("skips the unsubscribe footer for the test-fire sentinel", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail({ triggerId: TEST_FIRE_TRIGGER_ID_SENTINEL });
      const args = sendEmailMock.mock.calls[0]![0] as {
        content: { html: string; headers?: Record<string, string> };
      };
      expect(args.content.html).not.toContain("/unsubscribe?token=");
      expect(args.content.headers).toBeUndefined();
    });

    describe("given a malformed recipient address in the list", () => {
      it("skips the malformed address and sends only to the valid recipient", async () => {
        sendEmailMock.mockResolvedValue(undefined);
        // The second entry smuggles a CRLF + Bcc header. The EMAIL_RX guard in
        // sendPerRecipient must drop it before it reaches the provider's bcc
        // slot, so exactly one envelope (the valid address) is sent.
        await sendTriggerEmail({
          mailer,
          triggerEmails: ["ok@x.com", "evil@x.com\nBcc: victim@y.com"],
          triggerData,
          triggerName: "Quality Alert",
          triggerId: "trigger_test123",
          projectId: "project-1",
          projectSlug: "demo",
          triggerType: AlertType.WARNING,
          triggerMessage: "",
          baseHost: BASE_HOST,
          nextauthSecret: NEXTAUTH_SECRET,
        });

        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        const bcc = (sendEmailMock.mock.calls[0]![0] as { content: { bcc: string[] } }).content.bcc;
        expect(bcc).toEqual(["ok@x.com"]);
        // The smuggled address never reaches the provider in any form.
        const allArgs = JSON.stringify(sendEmailMock.mock.calls);
        expect(allArgs).not.toContain("victim@y.com");
      });
    });

    describe("given isRecipientSent / recordRecipientSent dedup callbacks", () => {
      describe("when the second of three recipients fails on the first attempt", () => {
        it("delivers recipient 1 once and recipients 2 and 3 on retry", async () => {
          // First attempt: recipient 1 resolves, recipient 2 rejects — so the
          // loop throws before reaching recipient 3. Only recipient 1 is
          // recorded as delivered.
          sendEmailMock
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce({ $metadata: { httpStatusCode: 500 } });

          const sent = new Set<string>();
          const recipients = ["a@x.com", "b@x.com", "c@x.com"];

          await expect(
            callEmailWithDedup(sent, { triggerEmails: recipients }),
          ).rejects.toBeInstanceOf(Error);

          // Attempt 1 stopped at the failing recipient 2 — recipient 3 was
          // never reached.
          const firstAttemptBccs = sendEmailMock.mock.calls.map(
            (c) => (c[0] as { content: { bcc: string[] } }).content.bcc,
          );
          expect(firstAttemptBccs).toEqual([["a@x.com"], ["b@x.com"]]);

          sendEmailMock.mockReset();
          sendEmailMock.mockResolvedValue(undefined);

          // Outbox retry: recipient 1 is already recorded, so only 2 and 3 send.
          await callEmailWithDedup(sent, { triggerEmails: recipients });

          const retryBccs = sendEmailMock.mock.calls.map(
            (c) => (c[0] as { content: { bcc: string[] } }).content.bcc,
          );
          expect(retryBccs).toEqual([["b@x.com"], ["c@x.com"]]);
        });
      });

      describe("when the first recipient succeeds but the second fails on the first attempt", () => {
        it("does not re-deliver the first recipient on retry", async () => {
          // First attempt: first recipient send resolves, second send rejects.
          sendEmailMock
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce({ $metadata: { httpStatusCode: 500 } });

          // Simulates a persistent delivered-set backed by TriggerSent rows.
          const sent = new Set<string>();

          // First dispatch — partial failure: second recipient throws.
          await expect(callEmailWithDedup(sent)).rejects.toBeInstanceOf(Error);

          expect(sendEmailMock).toHaveBeenCalledTimes(2); // attempted both

          // Reset the provider mock — second recipient now succeeds.
          sendEmailMock.mockReset();
          sendEmailMock.mockResolvedValue(undefined);

          // Second dispatch (outbox retry) — must skip the already-recorded first recipient.
          await callEmailWithDedup(sent);

          // Only the second recipient should be sent on retry.
          expect(sendEmailMock).toHaveBeenCalledTimes(1);
          const retrySentBcc = (sendEmailMock.mock.calls[0]![0] as { content: { bcc: string[] } })
            .content.bcc;
          expect(retrySentBcc).toEqual(["other@example.com"]);
        });
      });
    });
  });

  describe("when the provider throttles the send", () => {
    it("raises a retryable DispatchError", async () => {
      sendEmailMock.mockRejectedValue({ $metadata: { httpStatusCode: 500 } });
      const err = await callEmail().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(true);
    });
  });

  describe("when the provider rejects the address", () => {
    it("raises a non-retryable DispatchError", async () => {
      sendEmailMock.mockRejectedValue({ $metadata: { httpStatusCode: 400 } });
      const err = await callEmail().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
    });
  });
});
