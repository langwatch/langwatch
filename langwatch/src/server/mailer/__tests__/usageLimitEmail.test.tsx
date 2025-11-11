import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@react-email/render";
import { sendUsageLimitEmail } from "../usageLimitEmail";
import { sendEmail } from "../emailSender";

// Mock the email sender
vi.mock("../emailSender", () => ({
  sendEmail: vi.fn(),
}));

describe("usageLimitEmail", () => {
  const mockProjectData = [
    { id: "project-1", name: "Project Alpha", messageCount: 5000 },
    { id: "project-2", name: "Project Beta", messageCount: 3000 },
    { id: "project-3", name: "Project Gamma", messageCount: 2000 },
  ];

  const baseProps = {
    to: "admin@example.com",
    organizationName: "Test Organization",
    usagePercentage: 75.5,
    usagePercentageFormatted: "75.5",
    currentMonthMessagesCount: 10000,
    maxMonthlyUsageLimit: 13250,
    crossedThreshold: 70,
    projectUsageData: mockProjectData,
    actionUrl: "https://app.langwatch.ai/settings/usage",
    logoUrl: "https://example.com/logo.png",
    severity: "Medium",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendUsageLimitEmail", () => {
    it("should send email with correct subject line", async () => {
      await sendUsageLimitEmail(baseProps);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@example.com",
          subject: "Usage Limit Medium - 75.5% of limit reached",
        }),
      );
    });

    it("should include organization name in email HTML", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain("Test Organization");
    });

    it("should include usage percentage in email HTML", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain("75.5%");
      // React Email renders apostrophes as HTML entities
      expect(html).toContain("You&#x27;ve consumed");
      expect(html).toContain("75.5");
    });

    it("should display all projects in the table", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain("Project Alpha");
      expect(html).toContain("Project Beta");
      expect(html).toContain("Project Gamma");
      expect(html).toContain("5,000");
      expect(html).toContain("3,000");
      expect(html).toContain("2,000");
    });

    it("should display total message count", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain("10,000");
      expect(html).toContain("Total (3)");
    });

    it("should show upgrade message when threshold < 100", async () => {
      await sendUsageLimitEmail({
        ...baseProps,
        crossedThreshold: 90,
        usagePercentage: 92.5,
        usagePercentageFormatted: "92.5",
      });

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain(
        "To continue using LangWatch after reaching your limit, please upgrade your plan.",
      );
    });

    it("should show immediate upgrade message when threshold >= 100", async () => {
      await sendUsageLimitEmail({
        ...baseProps,
        crossedThreshold: 100,
        usagePercentage: 100,
        usagePercentageFormatted: "100.0",
      });

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain(
        "To continue using LangWatch, please upgrade your plan.",
      );
    });

    it("should use correct progress bar color for different usage levels", async () => {
      // Test red color for >= 100%
      await sendUsageLimitEmail({
        ...baseProps,
        usagePercentage: 100,
        crossedThreshold: 100,
      });

      let call = vi.mocked(sendEmail).mock.calls[0];
      let html = call[0].html;
      // React Email renders styles without spaces after colons
      expect(html).toContain('background-color:#dc2626'); // red

      vi.clearAllMocks();

      // Test orange color for >= 90%
      await sendUsageLimitEmail({
        ...baseProps,
        usagePercentage: 92,
        crossedThreshold: 90,
      });

      call = vi.mocked(sendEmail).mock.calls[0];
      html = call[0].html;
      // React Email renders styles without spaces after colons
      expect(html).toContain('background-color:#f59e0b'); // orange

      vi.clearAllMocks();

      // Test green color for < 70%
      await sendUsageLimitEmail({
        ...baseProps,
        usagePercentage: 50,
        crossedThreshold: 50,
      });

      call = vi.mocked(sendEmail).mock.calls[0];
      html = call[0].html;
      // React Email renders styles without spaces after colons
      expect(html).toContain('background-color:#10b981'); // green
    });

    it("should include action URL in button and project links", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain('href="https://app.langwatch.ai/settings/usage"');
    });

    it("should format large numbers with commas", async () => {
      await sendUsageLimitEmail({
        ...baseProps,
        currentMonthMessagesCount: 1234567,
        maxMonthlyUsageLimit: 2000000,
        projectUsageData: [
          { id: "p1", name: "Project", messageCount: 1234567 },
        ],
      });

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain("1,234,567");
      expect(html).toContain("2,000,000");
    });

    it("should cap progress bar width at 100%", async () => {
      await sendUsageLimitEmail({
        ...baseProps,
        usagePercentage: 150, // Over 100%
        crossedThreshold: 100,
      });

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      // Progress bar width should be capped at 100%
      // React Email renders styles without spaces after colons
      expect(html).toContain('width:100%');
    });

    it("should include logo URL in email", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain('https://example.com/logo.png');
    });

    it("should include help center link", async () => {
      await sendUsageLimitEmail(baseProps);

      const call = vi.mocked(sendEmail).mock.calls[0];
      const html = call[0].html;

      expect(html).toContain('href="https://docs.langwatch.ai"');
      expect(html).toContain("Help Center");
    });
  });
});

