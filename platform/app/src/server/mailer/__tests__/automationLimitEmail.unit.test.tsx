import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  automationLimitEmailSubject,
  renderAutomationLimitEmail,
  sendAutomationLimitEmail,
} from "../automationLimitEmail";
import { sendEmail } from "../emailSender";

vi.mock("../emailSender", () => ({
  sendEmail: vi.fn(),
}));

const baseProps = {
  automationName: "Failed traces to dataset",
  projectName: "Project Alpha",
  dailyCeiling: 1000,
  skippedToday: 12345,
  actionUrl:
    "https://app.langwatch.ai/proj/automations?drawer.open=automation&drawer.automationId=tr_1",
};

const ceilingProps = { ...baseProps, kind: "ceiling_reached" as const };
const pausedProps = { ...baseProps, kind: "paused" as const };

describe("automationLimitEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the ceiling-reached kind", () => {
    it("renders the automation and project names", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      expect(html).toContain("Failed traces to dataset");
      expect(html).toContain("Project Alpha");
    });

    it("says the automation starts again tomorrow", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      expect(html).toContain("It is still switched on");
      expect(html).toContain("it starts again tomorrow");
    });

    it("does not claim the automation was paused", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      expect(html).not.toContain("We have paused it");
    });

    it("titles the mail with the daily limit rather than a pause", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      expect(html).toContain("reached its daily limit");
    });
  });

  describe("given the paused kind", () => {
    it("says the automation was paused", async () => {
      const html = await renderAutomationLimitEmail(pausedProps);

      expect(html).toContain("We have paused it");
      expect(html).toContain("We paused");
    });

    it("tells the customer to narrow the condition and switch it back on", async () => {
      const html = await renderAutomationLimitEmail(pausedProps);

      expect(html).toContain("Narrow its condition");
      expect(html).toContain("switch it back on");
    });

    it("does not say it starts again tomorrow", async () => {
      const html = await renderAutomationLimitEmail(pausedProps);

      expect(html).not.toContain("starts again tomorrow");
    });
  });

  describe("given large counts", () => {
    it("formats the skipped count with thousands separators", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      // React splits an interpolation from its neighbouring text with a
      // comment node, so the sentence is matched in its two rendered halves.
      expect(html).toContain("12,345");
      expect(html).toContain("matches were skipped today");
    });

    it("formats the ceiling with thousands separators", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      expect(html).toContain("its limit of 1,000 a day");
    });
  });

  describe("given an action url", () => {
    it("carries it on the call to action", async () => {
      const html = await renderAutomationLimitEmail(ceilingProps);

      expect(html).toContain("drawer.open=automation");
      expect(html).toContain("drawer.automationId=tr_1");
      expect(html).toContain("Open the automation");
    });
  });

  describe("when building an automation-limit email subject", () => {
    it("names the pause for a paused automation", () => {
      expect(automationLimitEmailSubject(pausedProps)).toBe(
        "Automation paused: Failed traces to dataset",
      );
    });

    it("names the daily limit for a throttled automation", () => {
      expect(automationLimitEmailSubject(ceilingProps)).toBe(
        "Automation reached its daily limit: Failed traces to dataset",
      );
    });
  });

  describe("when sending an automation-limit email", () => {
    describe("when several admins are notified", () => {
      it("sends one mail per recipient with the matching subject", async () => {
        await sendAutomationLimitEmail({
          ...pausedProps,
          to: ["a@example.com", "b@example.com"],
        });

        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect(sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: "a@example.com",
            subject: "Automation paused: Failed traces to dataset",
          }),
        );
        expect(sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({ to: "b@example.com" }),
        );
      });
    });

    describe("when there are no recipients", () => {
      it("sends nothing", async () => {
        await sendAutomationLimitEmail({ ...pausedProps, to: [] });

        expect(sendEmail).not.toHaveBeenCalled();
      });
    });

    describe("when one recipient cannot be delivered to", () => {
      /** @scenario "One undeliverable admin does not silence the others" */
      it("keeps the batch rather than failing it", async () => {
        // The sends are independent, and the caller answers a failure by
        // trying the whole batch again, which would mail the admins who did
        // receive it twice.
        vi.mocked(sendEmail).mockRejectedValueOnce(new Error("bad mailbox"));

        await expect(
          sendAutomationLimitEmail({
            ...pausedProps,
            to: ["a@example.com", "b@example.com"],
          }),
        ).resolves.toBeUndefined();

        expect(sendEmail).toHaveBeenCalledTimes(2);
      });
    });

    describe("when no recipient can be delivered to", () => {
      /** @scenario "A limit email nobody received is reported as failed" */
      it("fails so the caller can try again", async () => {
        vi.mocked(sendEmail).mockRejectedValue(new Error("smtp refused"));

        await expect(
          sendAutomationLimitEmail({
            ...pausedProps,
            to: ["a@example.com", "b@example.com"],
          }),
        ).rejects.toThrow(/any of its 2 recipients/);
      });

      /** @scenario "A failed limit email is reported without quoting the provider" */
      it("names the failure code and drops the provider's wording", async () => {
        // A rejection quotes the envelope back, so repeating the message would
        // write the recipient's address into every log that handles the throw.
        vi.mocked(sendEmail).mockRejectedValue(
          Object.assign(new Error("550 5.1.1 <a@example.com>: recipient rejected"), {
            code: "EENVELOPE",
          }),
        );

        const error = await sendAutomationLimitEmail({
          ...pausedProps,
          to: ["a@example.com"],
        }).then(
          () => null,
          (thrown: unknown) => thrown as Error,
        );

        expect(error?.message).toContain("EENVELOPE");
        expect(error?.message).not.toContain("a@example.com");
        expect(error?.message).not.toContain("recipient rejected");
      });
    });
  });
});
