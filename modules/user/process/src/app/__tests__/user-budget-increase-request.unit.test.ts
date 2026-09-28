/**
 * @vitest-environment node
 * A budget-increase request is main's mail to the organization's first
 * administrator, linking the gateway's budgets page on this deployment.
 * @see specs/ai-governance/cli-wrappers/request-increase.feature, modules/user/specs/user.feature
 */
import { EmailDelivery, type EmailContent } from "@langwatch/mail";
import { UserBudgetRequestNotDeliveredError } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { budgetRequestMailer } from "../user-composition.build.ts";
import { createUserTestApp, createUserTestInfrastructure } from "./user.fixture.ts";

class RecordingMailer extends EmailDelivery {
  readonly sent: EmailContent[] = [];

  defaultFrom(): string {
    return "LangWatch <contact@langwatch.test>";
  }

  async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

const REQUEST = {
  organizationId: "org_1",
  scope: "user",
  scopeId: "usr_1",
  limitUsd: "10.00",
  spentUsd: "12.50",
  period: "monthly",
};

async function requestIncrease(input: {
  organizationName: string | null;
  publicBaseUrl: string | undefined;
  request?: Partial<typeof REQUEST>;
}) {
  const mail = new RecordingMailer();
  const members = createUserTestInfrastructure({
    budgetRequests: budgetRequestMailer({ mail, publicBaseUrl: input.publicBaseUrl }),
    organizations: {
      ...createUserTestInfrastructure().organizations,
      getBudgetIncreaseRecipient: vi.fn(async () => "admin@acme.test"),
      findName: vi.fn(async () => input.organizationName),
    },
  });
  const app = createUserTestApp({ members });
  const requester = await app.createCredentialUser({
    name: "Jane Developer",
    email: "jane@acme.test",
    passwordHash: "hashed:first",
  });

  const outcome = app.requestBudgetIncrease({
    ...REQUEST,
    ...input.request,
    userId: requester.id,
  });

  return { mail, outcome };
}

describe("user.requestBudgetIncrease", () => {
  describe("given an administrator and a public base URL", () => {
    it("mails the administrator the request, linking this deployment's budgets page", async () => {
      const { mail, outcome } = await requestIncrease({
        organizationName: "Acme",
        publicBaseUrl: "https://langwatch.example.com",
      });

      await expect(outcome).resolves.toEqual({ ok: true, sentTo: "admin@acme.test" });
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({
        to: "admin@acme.test",
        subject: "Budget increase requested by jane@acme.test",
      });
      expect(mail.sent[0]?.html).toContain("https://langwatch.example.com/gateway/budgets");
      expect(mail.sent[0]?.html).toContain("Acme");
    });
  });

  describe("given an organization that carries no name", () => {
    it("still sends the request, with the name left blank as main did", async () => {
      const { mail, outcome } = await requestIncrease({
        organizationName: null,
        publicBaseUrl: "https://langwatch.example.com",
      });

      await expect(outcome).resolves.toEqual({ ok: true, sentTo: "admin@acme.test" });
      expect(mail.sent).toHaveLength(1);
    });
  });

  describe.each(["scope", "scopeId", "limitUsd", "spentUsd", "period"] as const)(
    "given a request whose %s is blank",
    (field) => {
      /** @scenario "A request whose scope, limit or spend is blank still emails the admin" */
      it("still mails the administrator, as main did", async () => {
        const { mail, outcome } = await requestIncrease({
          organizationName: "Acme",
          publicBaseUrl: "https://langwatch.example.com",
          request: { [field]: "" },
        });

        await expect(outcome).resolves.toEqual({ ok: true, sentTo: "admin@acme.test" });
        expect(mail.sent).toHaveLength(1);
      });
    },
  );

  describe("given a blank limit and spend and no public base URL", () => {
    /** @scenario "A blank field does not hide a delivery failure" */
    it("refuses as not delivered and mails nothing", async () => {
      const { mail, outcome } = await requestIncrease({
        organizationName: "Acme",
        publicBaseUrl: undefined,
        request: { limitUsd: "", spentUsd: "" },
      });

      await expect(outcome).rejects.toBeInstanceOf(UserBudgetRequestNotDeliveredError);
      expect(mail.sent).toEqual([]);
    });
  });

  describe("given a process that names no public base URL", () => {
    it("refuses as not delivered and mails nothing", async () => {
      const { mail, outcome } = await requestIncrease({
        organizationName: "Acme",
        publicBaseUrl: undefined,
      });

      await expect(outcome).rejects.toBeInstanceOf(UserBudgetRequestNotDeliveredError);
      expect(mail.sent).toEqual([]);
    });
  });
});
