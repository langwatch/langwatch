import { describe, expect, it } from "vitest";

import {
  digestCodingAgentWeekProps,
  digestCodingAgentWeekTemplate,
  renderDigestCodingAgentWeekEmail,
} from "../digest-coding-agent-week.tsx";

const renderLightUser = async (overrides: { totalsAtLeast?: boolean }) => {
  const fixture = digestCodingAgentWeekTemplate.fixtures.find((each) => each.name === "light user");
  if (!fixture) throw new Error("fixture missing: light user");
  const base = digestCodingAgentWeekProps.parse(fixture.props);
  return renderDigestCodingAgentWeekEmail({ ...base, ...overrides });
};

describe("renderDigestCodingAgentWeekEmail", () => {
  describe("given a week that dropped metric series past its cap", () => {
    /** @scenario "A person's week past its series cap reads its totals as floors" */
    it("reads each total as at least what it kept", async () => {
      const { subject, html } = await renderLightUser({ totalsAtLeast: true });

      expect(subject).toBe("Your coding agents this week: 5 sessions, at least 420K tokens");
      expect(html).not.toContain("Cost");
      expect(html).toContain("at least 420K");
      expect(html).toContain("at least 48 min active");
    });
  });

  describe("given a week whose series all fit", () => {
    /** @scenario "A person's week past its series cap reads its totals as floors" */
    it("shows its totals plainly", async () => {
      const { subject, html } = await renderLightUser({});

      expect(subject).toBe("Your coding agents this week: 5 sessions, 420K tokens");
      expect(html).not.toContain("at least");
      expect(html).not.toContain("Cost");
    });
  });
});
