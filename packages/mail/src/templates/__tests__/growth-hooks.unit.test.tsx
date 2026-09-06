import { describe, expect, it } from "vitest";
import { automationLimitEmailTemplate } from "../automation-limit-email.tsx";
import { budgetIncreaseRequestEmailTemplate } from "../budget-increase-request-email.tsx";
import { DOCUMENTATION_URL } from "../email-layout.tsx";
import { mailTemplates } from "../index.ts";
import { inviteEmailTemplate } from "../invite-email.tsx";
import { inviteReRequestEmailTemplate } from "../invite-re-request-email.tsx";
import {
  domainAutoJoinedTemplate,
  joinRequestApprovedTemplate,
  joinRequestArrivedTemplate,
  joinRequestExpiredTemplate,
} from "../join-request-emails.tsx";
import { licenseEmailTemplate } from "../license-email.tsx";
import { renderMailTemplate, type MailTemplate } from "../registry.ts";
import { FIRST_STEPS_LINKS } from "../onboarding/first-steps.tsx";
import { signUpVerificationEmailTemplate } from "../sign-up-verification-email.tsx";
import { triggerDigestEmailTemplate } from "../trigger-digest-email.tsx";
import { usageLimitEmailTemplate } from "../usage-limit-email.tsx";

/**
 * Every hook is optional data behind a gate, so every hook is two assertions:
 * what the reader sees when the sender could answer, and what they see when it
 * could not. The pricing hooks are five, because a price that is true of an
 * organization on the public ladder is false of one on its own terms.
 *
 * Assertions are on rendered content — a number, a name, an address — rather
 * than on prose, so a copy edit does not fail a test that is about whether the
 * hook fired.
 */

const html = async (template: MailTemplate, props: unknown): Promise<string> =>
  (await renderMailTemplate(template, props)).html;

const ACCOUNT_TEAM_URL = "https://langwatch.ai/contact";
const PLAN_URL = "https://app.langwatch.ai/settings/subscription";

describe("given the sign-up verification email", () => {
  const base = { email: "morgan@acme.example", verificationUrl: "https://app.langwatch.ai/v/1" };

  describe("when a quickstart address is known", () => {
    /** @scenario "The confirmation mail shows the first-trace step when the quickstart is known" */
    it("shows the first-trace setup lines and the quickstart link", async () => {
      const rendered = await html(signUpVerificationEmailTemplate, {
        ...base,
        firstSteps: {},
      });

      expect(rendered).toContain("setupObservability");
      expect(rendered).toContain(FIRST_STEPS_LINKS.typescript);
    });
  });

  describe("when no quickstart address is known", () => {
    /** @scenario "The confirmation mail is only a confirmation without the quickstart" */
    it("shows no setup lines", async () => {
      const rendered = await html(signUpVerificationEmailTemplate, base);

      expect(rendered).not.toContain("setupObservability");
    });
  });
});

describe("given the invitation email", () => {
  const base = {
    email: "morgan@acme.example",
    acceptInviteUrl: "https://app.langwatch.ai/invite/inv_1",
  };

  describe("when the organization already tracks projects", () => {
    /** @scenario "An invitation names what the team already tracks" */
    it("names how many projects the team tracks", async () => {
      const rendered = await html(inviteEmailTemplate, {
        ...base,
        organization: { name: "Acme Corp", projectCount: 4 },
      });

      expect(rendered).toContain("4 projects");
    });
  });

  describe("when the organization tracks nothing yet", () => {
    /** @scenario "An invitation to an empty workspace says nothing about projects" */
    it("names no project count", async () => {
      const rendered = await html(inviteEmailTemplate, {
        ...base,
        organization: { name: "Acme Corp", projectCount: 0 },
      });

      expect(rendered).not.toContain("already tracks");
    });
  });

  describe("when the inviter is named", () => {
    /** @scenario "An invitation names the person who sent it" */
    it("names the inviter", async () => {
      const rendered = await html(inviteEmailTemplate, {
        ...base,
        organization: { name: "Acme Corp" },
        inviter: { name: "Priya Nair" },
      });

      expect(rendered).toContain("Priya Nair");
    });
  });
});

describe("given the invitation re-request email", () => {
  const base = {
    adminEmail: "priya@acme.example",
    organizationName: "Acme Corp",
    invitedEmail: "morgan@acme.example",
    membersSettingsUrl: "https://app.langwatch.ai/settings/members",
  };

  describe("when a seat is still free", () => {
    /** @scenario "The re-request mail says a seat is free" */
    it("gives the seats used against the seats the plan covers", async () => {
      const rendered = await html(inviteReRequestEmailTemplate, {
        ...base,
        seats: { used: 3, ceiling: 5 },
      });

      expect(rendered).toContain("Seats on your plan");
      expect(rendered).toContain(">3</td>");
    });
  });

  describe("when every seat is taken", () => {
    /** @scenario "The re-request mail does not put a wall in front of an administrator" */
    it("gives no seat count", async () => {
      const rendered = await html(inviteReRequestEmailTemplate, {
        ...base,
        seats: { used: 5, ceiling: 5 },
      });

      expect(rendered).not.toContain("Seats on your plan");
    });
  });
});

describe("given the join request arrived email", () => {
  const base = {
    adminEmail: "priya@acme.example",
    organizationName: "Acme Corp",
    requesterName: "Morgan Ellis",
    domain: "acme.example",
    membersSettingsUrl: "https://app.langwatch.ai/settings/members",
  };

  describe("when two requests from the domain have already been approved", () => {
    /** @scenario "A third request from one domain offers automatic joining" */
    it("offers letting that domain join without asking", async () => {
      const rendered = await html(joinRequestArrivedTemplate, {
        ...base,
        approvedFromDomainCount: 2,
      });

      expect(rendered).toContain("join without asking");
      expect(rendered).toContain("2 requests");
    });
  });

  describe("when this is the first request from the domain", () => {
    /** @scenario "The first request from a domain offers nothing" */
    it("offers nothing", async () => {
      const rendered = await html(joinRequestArrivedTemplate, {
        ...base,
        approvedFromDomainCount: 0,
      });

      expect(rendered).not.toContain("join without asking");
    });
  });
});

describe("given the join request approved email", () => {
  describe("when an onboarding address is known", () => {
    /** @scenario "An approved requester is given the checklist beside the door" */
    it("links the checklist and keeps the organization as the action", async () => {
      const rendered = await html(joinRequestApprovedTemplate, {
        requesterEmail: "morgan@acme.example",
        organizationName: "Acme Corp",
        organizationUrl: "https://app.langwatch.ai/acme-corp",
        onboardingUrl: "https://app.langwatch.ai/onboarding",
      });

      expect(rendered).toContain("https://app.langwatch.ai/onboarding");
      expect(rendered).toContain('class="lw-action" href="https://app.langwatch.ai/acme-corp"');
    });
  });
});

describe("given the join request expired email", () => {
  describe("when the requester has no project of their own", () => {
    /** @scenario "A lapsed request offers a project to work in meanwhile" */
    it("links a personal project without making it the action", async () => {
      const rendered = await html(joinRequestExpiredTemplate, {
        organizationName: "Acme Corp",
        personalProjectUrl: "https://app.langwatch.ai/personal-morgan",
      });

      expect(rendered).toContain("https://app.langwatch.ai/personal-morgan");
      expect(rendered).not.toContain('class="lw-action"');
    });
  });
});

describe("given the domain auto-joined email", () => {
  describe("when the seat count is known", () => {
    /** @scenario "An automatic join reports the seats it took" */
    it("reports the seats after the members settings action", async () => {
      const rendered = await html(domainAutoJoinedTemplate, {
        adminEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        memberName: "Morgan Ellis",
        domain: "acme.example",
        membersSettingsUrl: "https://app.langwatch.ai/settings/members",
        seats: { used: 4, ceiling: 5 },
      });

      expect(rendered).toContain("Seats on your plan");
      expect(rendered.indexOf("Seats on your plan")).toBeGreaterThan(
        rendered.indexOf('class="lw-action"'),
      );
    });
  });
});

describe("given the licence email", () => {
  const base = {
    email: "priya@acme.example",
    licenseKey: "eyJhbGciOiJFZERTQSJ9.key",
    maxMembers: 50,
    expiresAt: "2027-01-01T00:00:00.000Z",
    organizationName: "Acme Corp",
  };

  describe("when the plan is on the public ladder", () => {
    /** @scenario "A licence from the public ladder links what its plan unlocks" */
    it("links what the plan unlocks", async () => {
      const rendered = await html(licenseEmailTemplate, {
        ...base,
        planType: "ACCELERATE",
        unlockedFeatures: {
          kind: "self_serve",
          url: "https://docs.langwatch.ai/evaluations/overview",
        },
      });

      expect(rendered).toContain("https://docs.langwatch.ai/evaluations/overview");
    });
  });

  describe("when the licence is on negotiated terms", () => {
    /** @scenario "A negotiated licence is pointed at its account team" */
    it("names the account team and links no plan page", async () => {
      const rendered = await html(licenseEmailTemplate, {
        ...base,
        planType: "ENTERPRISE",
        unlockedFeatures: { kind: "account_team", contactUrl: ACCOUNT_TEAM_URL },
      });

      expect(rendered).toContain(ACCOUNT_TEAM_URL);
      expect(rendered).not.toContain("docs.langwatch.ai/evaluations");
    });
  });

  describe("when nothing was resolved for the licence", () => {
    /** @scenario "A licence nothing was resolved for says nothing" */
    it("names neither a plan page nor an account team", async () => {
      const rendered = await html(licenseEmailTemplate, { ...base, planType: "PARTNER_TRIAL" });

      expect(rendered).not.toContain(ACCOUNT_TEAM_URL);
      expect(rendered).not.toContain("unlocks");
    });
  });
});

describe("given the budget increase request email", () => {
  const base = {
    requesterEmail: "morgan@acme.example",
    organizationName: "Acme Corp",
    budgetsUrl: "https://app.langwatch.ai/settings/budgets",
    scope: "project",
    scopeId: "project_1",
    spentUsd: "248.60",
  };

  describe("when a limit is set", () => {
    /** @scenario "A budget request states the spend against the limit" */
    it("states the share of the limit already spent", async () => {
      const rendered = await html(budgetIncreaseRequestEmailTemplate, {
        ...base,
        limitUsd: "250.00",
      });

      expect(rendered).toContain("Of the limit");
      expect(rendered).toContain("99%");
    });
  });

  describe("when no limit is set", () => {
    /** @scenario "A budget request with no limit set states no share" */
    it("states no share", async () => {
      const rendered = await html(budgetIncreaseRequestEmailTemplate, {
        ...base,
        limitUsd: "0.00",
      });

      expect(rendered).not.toContain("Of the limit");
    });
  });
});

const usageBase = {
  organizationName: "Acme Corp",
  usagePercentage: 78.4,
  usagePercentageFormatted: "78.4",
  currentMonthMessagesCount: 784_120,
  maxMonthlyUsageLimit: 1_000_000,
  crossedThreshold: 70,
  projectUsageData: [
    { id: "project_1", name: "Support agent", messageCount: 512_403 },
    { id: "project_2", name: "Sales copilot", messageCount: 271_717 },
  ],
  actionUrl: "https://app.langwatch.ai/settings/usage",
};

const selfServePlan = {
  kind: "self_serve" as const,
  name: "Accelerate",
  price: 199,
  currency: "USD",
  billingPeriod: "monthly" as const,
  url: PLAN_URL,
  raisesLimitTo: 5_000_000,
};

describe("given the usage limit email", () => {
  describe("when the organization buys from the public ladder", () => {
    /** @scenario "The usage warning names the plan that removes the limit" */
    it("names the plan and its monthly price", async () => {
      const rendered = await html(usageLimitEmailTemplate, {
        ...usageBase,
        nextStep: selfServePlan,
      });

      expect(rendered).toContain("Upgrade to Accelerate");
      expect(rendered).toContain("$199 a month");
      expect(rendered).toContain("5,000,000");
      expect(rendered).toContain(PLAN_URL);
    });
  });

  describe("when the limit is fully crossed and the organization can buy more", () => {
    /** @scenario "The usage warning puts the plan under the fix at a full crossing" */
    it("states the interruption before it names the plan", async () => {
      const rendered = await html(usageLimitEmailTemplate, {
        ...usageBase,
        usagePercentage: 100,
        usagePercentageFormatted: "100.0",
        crossedThreshold: 100,
        nextStep: selfServePlan,
      });

      expect(rendered.indexOf("To carry on using LangWatch")).toBeLessThan(
        rendered.indexOf("$199"),
      );
    });
  });

  describe("when the organization is on negotiated terms", () => {
    /** @scenario "An organization on negotiated terms is never quoted a price" */
    it("names the account team and quotes no price", async () => {
      const rendered = await html(usageLimitEmailTemplate, {
        ...usageBase,
        nextStep: { kind: "account_team", contactUrl: ACCOUNT_TEAM_URL },
      });

      expect(rendered).toContain(ACCOUNT_TEAM_URL);
      expect(rendered).not.toContain("$199");
      expect(rendered).not.toContain(PLAN_URL);
      expect(rendered).not.toContain("move to a larger plan");
    });
  });

  describe("when nothing above this organization was resolved", () => {
    /** @scenario "An organization with nothing above it is offered nothing" */
    it("names neither a price nor an account team", async () => {
      const rendered = await html(usageLimitEmailTemplate, usageBase);

      expect(rendered).not.toContain("$199");
      expect(rendered).not.toContain(ACCOUNT_TEAM_URL);
    });
  });

  describe("when the organization is metered in events", () => {
    /** @scenario "The usage warning counts in the unit the organization is metered in" */
    it("counts in events rather than in messages", async () => {
      const rendered = await html(usageLimitEmailTemplate, {
        ...usageBase,
        usageUnit: "events",
      });

      expect(rendered).toContain("784,120 of 1,000,000 events");
      expect(rendered).not.toContain("of 1,000,000 messages");
    });
  });

  describe("when one project carries most of the month", () => {
    /** @scenario "The usage warning names the project carrying most of the month" */
    it("names that project as the place to look first", async () => {
      const rendered = await html(usageLimitEmailTemplate, usageBase);

      expect(rendered).toContain("Most of the month is Support agent");
    });
  });

  describe("when the volume is spread evenly across projects", () => {
    /** @scenario "An even spread across projects names none of them" */
    it("names no project as the place to look first", async () => {
      const rendered = await html(usageLimitEmailTemplate, {
        ...usageBase,
        projectUsageData: [
          { id: "project_1", name: "Support agent", messageCount: 261_373 },
          { id: "project_2", name: "Sales copilot", messageCount: 261_373 },
          { id: "project_3", name: "Internal tools", messageCount: 261_374 },
        ],
      });

      expect(rendered).not.toContain("Most of the month is");
    });
  });
});

const automationBase = {
  automationName: "Escalate low satisfaction",
  projectName: "Support agent",
  dailyCeiling: 500,
  skippedToday: 1_284,
  actionUrl: "https://app.langwatch.ai/support-agent/automations/auto_1",
};

const selfServeCeiling = {
  kind: "self_serve" as const,
  name: "Accelerate",
  dailyCeiling: 5_000,
  price: 199,
  currency: "USD",
  billingPeriod: "monthly" as const,
  url: PLAN_URL,
};

describe("given the automation limit email", () => {
  describe("when a ceiling was reached and the organization buys from the public ladder", () => {
    /** @scenario "A reached ceiling names the tier that allows more" */
    it("names the tier and the matches a day it allows", async () => {
      const rendered = await html(automationLimitEmailTemplate, {
        ...automationBase,
        kind: "ceiling_reached",
        nextStep: selfServeCeiling,
      });

      expect(rendered).toContain("Upgrade to Accelerate");
      expect(rendered).toContain("5,000 matches");
      expect(rendered).toContain("$199 a month");
    });
  });

  describe("when a ceiling was reached on negotiated terms", () => {
    /** @scenario "A reached ceiling on negotiated terms names the account team" */
    it("names the account team and no tier ceiling", async () => {
      const rendered = await html(automationLimitEmailTemplate, {
        ...automationBase,
        kind: "ceiling_reached",
        nextStep: { kind: "account_team", contactUrl: ACCOUNT_TEAM_URL },
      });

      expect(rendered).toContain(ACCOUNT_TEAM_URL);
      expect(rendered).not.toContain("5,000 matches");
      expect(rendered).not.toContain(PLAN_URL);
    });
  });

  describe("when the automation was paused", () => {
    /** @scenario "A paused automation is never sold more ceiling" */
    it("offers no tier and no ceiling", async () => {
      const rendered = await html(automationLimitEmailTemplate, {
        ...automationBase,
        kind: "paused",
        nextStep: selfServeCeiling,
      });

      expect(rendered).not.toContain("5,000 matches");
      expect(rendered).not.toContain(PLAN_URL);
    });
  });

  describe("when the organization is metered in events", () => {
    /** @scenario "The automation notice counts in the unit the organization is metered in" */
    it("reads in events rather than in messages", async () => {
      const rendered = await html(automationLimitEmailTemplate, {
        ...automationBase,
        kind: "ceiling_reached",
        usageUnit: "events",
      });

      expect(rendered).toContain("matched more events today");
      expect(rendered).not.toContain("matched more messages today");
    });
  });
});

describe("given the trigger digest email", () => {
  const base = {
    triggerName: "Low satisfaction on checkout",
    triggerType: "alert",
    triggerMessage: "",
    projectSlug: "support-agent",
    baseHost: "https://app.langwatch.ai",
    entries: [{ traceId: "trace_1" }],
  };

  describe("when the automation is named", () => {
    /** @scenario "A default digest offers the automation's own message" */
    it("links where the automation's own message is written", async () => {
      const rendered = await html(triggerDigestEmailTemplate, {
        ...base,
        triggerId: "auto_7Kd2ppQ4",
      });

      expect(rendered).toContain("drawer.automationId=auto_7Kd2ppQ4");
    });
  });

  describe("when the automation is not named", () => {
    /** @scenario "A digest with no automation identifier offers nothing" */
    it("links nothing of the kind", async () => {
      const rendered = await html(triggerDigestEmailTemplate, base);

      expect(rendered).not.toContain("drawer.automationId");
    });
  });
});

describe("given every registered template", () => {
  const everyFixture = mailTemplates.flatMap((template) =>
    template.fixtures.map((fixture) => ({ template, fixture })),
  );

  describe("when a rendered message is read", () => {
    /** @scenario "Every message carries the documentation link once" */
    it("carries the documentation address exactly once, from the shared shell", async () => {
      for (const { template, fixture } of everyFixture) {
        const rendered = await html(template, fixture.props);
        const occurrences = rendered.split(`href="${DOCUMENTATION_URL}"`).length - 1;

        expect({ id: template.id, fixture: fixture.name, occurrences }).toEqual({
          id: template.id,
          fixture: fixture.name,
          occurrences: 1,
        });
      }
    });
  });

  describe("when a message somebody receives while proving who they are is read", () => {
    const untouchable = new Set([
      "reset-password",
      "join-request-reminder",
      "join-request-rejected",
    ]);

    /** @scenario "The messages a person receives while proving who they are carry no hook" */
    it("names no plan, price, seat count or upgrade in any of them", async () => {
      const forbidden = [/\bplan\b/i, /\$\d/, /\bseats?\b/i, /\bupgrade\b/i, /account team/i];

      for (const { template, fixture } of everyFixture.filter(({ template }) =>
        untouchable.has(template.id),
      )) {
        const rendered = await html(template, fixture.props);
        const body = rendered.slice(rendered.indexOf("<body"));
        const offending = forbidden.filter((pattern) => pattern.test(body)).map(String);

        expect({ id: template.id, fixture: fixture.name, offending }).toEqual({
          id: template.id,
          fixture: fixture.name,
          offending: [],
        });
      }
    });
  });
});
