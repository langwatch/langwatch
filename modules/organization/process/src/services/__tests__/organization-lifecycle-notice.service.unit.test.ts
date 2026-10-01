/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { RecordSignedUpCommandData } from "../../eventing/organization-lifecycle.events.ts";
import { OrganizationLifecycleNoticeService } from "../organization-lifecycle-notice.service.ts";

const idle = { send: async () => undefined };

function notices(
  recordSignedUp: { send: (data: RecordSignedUpCommandData) => Promise<void> },
  recordIntegrationMethodChosen: { send: (data: unknown) => Promise<void> } = idle,
  recordPersonalWorkspaceProvisioned: { send: (data: unknown) => Promise<void> } = idle,
) {
  const reportError = vi.fn();
  const service = OrganizationLifecycleNoticeService.create({ reportError });
  service.connect({
    recordSignedUp,
    recordMembersInvited: idle,
    recordInviteAccepted: idle,
    recordIntegrationMethodChosen,
    recordPersonalWorkspaceProvisioned,
  });
  return { service, reportError };
}

const signUp = {
  organizationId: "org_acme",
  userId: "user_admin",
  organizationName: "Acme",
  primaryIntent: "LLM_OPS",
};

describe("organization's lifecycle notices", () => {
  it("records a sign-up against the organization with the questionnaire it can read", async () => {
    const sent: RecordSignedUpCommandData[] = [];
    const { service } = notices({
      send: async (data) => {
        sent.push(data);
      },
    });

    service.signedUp({ ...signUp, signUpData: { yourRole: "engineer", terms: true } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({
      ...signUp,
      tenantId: "org_acme",
      signUpData: { yourRole: "engineer", terms: true },
    });
  });

  /** @scenario "Customer.io failure during signup does not block onboarding" */
  it("reports a failed record and never throws into the ceremony", async () => {
    const failure = new Error("event store unavailable");
    const { service, reportError } = notices({
      send: async () => {
        throw failure;
      },
    });

    expect(() => service.signedUp(signUp)).not.toThrow();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
  });

  it("reports, rather than throws, when the pipeline is not registered in this process", () => {
    const reportError = vi.fn();
    const service = OrganizationLifecycleNoticeService.create({ reportError });

    expect(() => service.signedUp(signUp)).not.toThrow();
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("records a chosen integration method under the person's own id", async () => {
    const sent: unknown[] = [];
    const { service } = notices(idle, {
      send: async (data) => {
        sent.push(data);
      },
    });

    service.integrationMethodChosen({ userId: "user_admin", selection: "manually" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({
      tenantId: "user_admin",
      userId: "user_admin",
      selection: "manually",
    });
  });

  /** @scenario "Integration-method identify failure does not break onboarding navigation" */
  it("reports a failed integration-method record and never throws into onboarding", async () => {
    const failure = new Error("event store unavailable");
    const { service, reportError } = notices(idle, {
      send: async () => {
        throw failure;
      },
    });

    expect(() =>
      service.integrationMethodChosen({ userId: "user_admin", selection: "via-platform" }),
    ).not.toThrow();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
  });

  it("reports a selection outside main's four and records nothing", () => {
    const send = vi.fn(async () => undefined);
    const { service, reportError } = notices(idle, { send });

    service.integrationMethodChosen({ userId: "user_admin", selection: "unknown" });

    expect(reportError).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
