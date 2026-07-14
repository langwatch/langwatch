import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../emailSender";
import { sendLicenseEmail } from "../licenseEmail";

vi.mock("../emailSender", () => ({
  sendEmail: vi.fn(),
}));

const baseParams = {
  email: "buyer@acme.com",
  licenseKey: "dGVzdC1saWNlbnNlLWtleS1jb250ZW50",
  planType: "GROWTH",
  maxMembers: 5,
  expiresAt: "2027-03-02T12:00:00.000Z",
  organizationName: "Acme Corp",
};

describe("sendLicenseEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when sending a license email", () => {
    it("calls sendEmail with correct recipient", async () => {
      await sendLicenseEmail(baseParams);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "buyer@acme.com",
        }),
      );
    });

    it("uses subject mentioning LangWatch License", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].subject).toContain("LangWatch License");
    });
  });

  describe("when rendering the email body", () => {
    it("contains the license key", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("dGVzdC1saWNlbnNlLWtleS1jb250ZW50");
    });

    it("contains the plan type", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("Growth");
    });

    it("contains the seat count", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("5");
    });

    it("contains the expiration date", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("March 2, 2027");
    });

    it("contains activation instructions", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("Settings");
      expect(call[0].html).toContain("License");
    });
  });

  describe("when attaching the license file", () => {
    it("uses orgName in filename as <orgName>.langwatch-license", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments).toBeDefined();
      expect(call[0].attachments).toHaveLength(1);
      expect(call[0].attachments![0]!.filename).toBe(
        "Acme_Corp.langwatch-license",
      );
    });

    it("sanitizes dots in org name to avoid extension confusion", async () => {
      await sendLicenseEmail({
        ...baseParams,
        organizationName: "acme.corp.inc",
      });

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments![0]!.filename).toBe(
        "acme_corp_inc.langwatch-license",
      );
    });

    it("sanitizes filesystem-unsafe characters from org name", async () => {
      await sendLicenseEmail({
        ...baseParams,
        organizationName: 'My/Company\\Name:"test"',
      });

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments![0]!.filename).toBe(
        "MyCompanyNametest.langwatch-license",
      );
    });

    it("uses email as filename when org name is empty", async () => {
      await sendLicenseEmail({
        ...baseParams,
        organizationName: "buyer@acme.com",
      });

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments![0]!.filename).toBe(
        "buyer@acme_com.langwatch-license",
      );
    });

    it("attaches the license key as file content", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments![0]!.content).toBe(
        "dGVzdC1saWNlbnNlLWtleS1jb250ZW50",
      );
    });

    it("uses application/octet-stream content type", async () => {
      await sendLicenseEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments![0]!.contentType).toBe(
        "application/octet-stream",
      );
    });

    it("ensures filename always ends with .langwatch-license", async () => {
      await sendLicenseEmail({
        ...baseParams,
        organizationName: "anything",
      });

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].attachments![0]!.filename).toMatch(
        /\.langwatch-license$/,
      );
    });
  });
});
