import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBudgetIncreaseRequestEmail } from "../budgetIncreaseRequestEmail";
import { sendEmail } from "../emailSender";
import { TestMailer } from "./mailer.test-double";

vi.mock("../emailSender", () => ({
  sendEmail: vi.fn(),
}));

const baseParams = {
  mailer: new TestMailer(),
  to: "admin@acme.test",
  requesterEmail: "developer@acme.test",
  requesterName: "Jane Developer",
  organizationName: "ACME Corp",
  scope: "user",
  scopeId: "usr_xyz",
  limitUsd: "10.00",
  spentUsd: "12.50",
  period: "monthly",
};

describe("sendBudgetIncreaseRequestEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when sending the request email", () => {
    it("calls sendEmail addressed to the resolved admin", async () => {
      await sendBudgetIncreaseRequestEmail(baseParams);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.objectContaining({ to: "admin@acme.test" }) }),
      );
    });

    it("uses a subject naming the requester email", async () => {
      await sendBudgetIncreaseRequestEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].content.subject).toContain("Budget increase requested");
      expect(call[0].content.subject).toContain("developer@acme.test");
    });
  });

  describe("when rendering the email body", () => {
    it("includes the requester name + email and the org name", async () => {
      await sendBudgetIncreaseRequestEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].content.html).toContain("Jane Developer");
      expect(call[0].content.html).toContain("developer@acme.test");
      expect(call[0].content.html).toContain("ACME Corp");
    });

    it("includes the spend / limit / period context", async () => {
      await sendBudgetIncreaseRequestEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].content.html).toContain("usr_xyz");
      expect(call[0].content.html).toContain("10.00");
      expect(call[0].content.html).toContain("12.50");
      expect(call[0].content.html).toContain("monthly");
    });

    describe("when the user attached a free-form message", () => {
      it("renders the message verbatim under a 'Message from the user' heading", async () => {
        await sendBudgetIncreaseRequestEmail({
          ...baseParams,
          message: "Need it for the demo on Friday — usually under limit",
        });

        const call = vi.mocked(sendEmail).mock.calls[0]!;
        expect(call[0].content.html).toContain("Message from the user");
        expect(call[0].content.html).toContain("Need it for the demo on Friday");
      });
    });

    describe("when the user did NOT attach a message", () => {
      it("omits the 'Message from the user' section entirely", async () => {
        await sendBudgetIncreaseRequestEmail(baseParams);

        const call = vi.mocked(sendEmail).mock.calls[0]!;
        expect(call[0].content.html).not.toContain("Message from the user");
      });
    });

    it("includes a link to LangWatch governance budgets for the admin to act", async () => {
      await sendBudgetIncreaseRequestEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].content.html).toContain("/gateway/budgets");
      expect(call[0].content.html).toContain("Approve via LangWatch");
    });
  });
});
