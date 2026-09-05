import { describe, expect, it } from "vitest";
import { renderGovernanceAlertEmail } from "../governanceAlertEmail";

describe("renderGovernanceAlertEmail()", () => {
  describe("given a privacy-safe alert summary with unsafe labels", () => {
    describe("when the email is rendered", () => {
      it("escapes labels and contains only the privacy-safe alert summary", async () => {
        const html = await renderGovernanceAlertEmail({
          monitorName: "Activity <Monitor>",
          ruleName: "Spend <script>alert('x')</script>",
          source: "All organization sources",
          windowStartIso: "2026-08-24T00:00:00.000Z",
          windowEndIso: "2026-08-24T01:00:00.000Z",
          dashboardUrl: "https://app.example.com/governance",
        });

        expect(html).toContain("Activity &lt;Monitor&gt;");
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("rawPrompt");
        expect(html).toContain("https://app.example.com/governance");
      });
    });
  });
});
