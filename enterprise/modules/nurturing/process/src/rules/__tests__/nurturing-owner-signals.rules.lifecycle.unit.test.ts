// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import { nurturingSignalKey } from "../../eventing/nurturing-signal.commands.ts";
import {
  firstTraceRecordedSignal,
  integrationMethodChosenSignal,
  inviteAcceptedSignal,
  membersInvitedSignal,
  promptCreatedSignal,
  scenarioCreatedSignal,
  scenarioRunSucceededSignal,
  sessionStartedSignal,
  signedUpSignal,
  ssoAutoAddedSignal,
  traceReceivedSignal,
  workflowCreatedSignal,
} from "../nurturing-owner-signals.rules.ts";

const AT = Date.UTC(2026, 8, 29, 12);
const org = { tenantId: "org_acme", organizationId: "org_acme", occurredAt: AT };

describe("auth's lifecycle events", () => {
  it("raise a session with the person's id and the time, no profile", () => {
    const data = { tenantId: "user_ada", userId: "user_ada", occurredAt: AT };
    expect(sessionStartedSignal({ data, aggregateId: "user_ada" })).toEqual({
      kind: "session_started",
      sourceEventId: `user_ada:${AT}`,
      tenantId: "user_ada",
      occurredAt: AT,
      userId: "user_ada",
      hasOrganization: true,
    });
  });

  it("raise a domain auto-join with ids only, once per person and organization", () => {
    const data = { ...org, userId: "user_ada", organizationName: "Acme" };
    expect(ssoAutoAddedSignal({ data, aggregateId: "user_ada" })).toEqual({
      kind: "sso_auto_added",
      sourceEventId: "org_acme:user_ada",
      tenantId: "org_acme",
      occurredAt: AT,
      userId: "user_ada",
      organizationId: "org_acme",
      organizationName: "Acme",
    });
  });
});

describe("organization's lifecycle events", () => {
  /** @scenario "Team member invite updates member count and fires event" */
  it("raise one invitation batch with a role per invite and the member count", () => {
    const data = {
      ...org,
      userId: "user_admin",
      inviteIds: ["invite_1", "invite_2"],
      roles: ["MEMBER", "ADMIN"],
      teamMemberCount: 4,
    };
    expect(membersInvitedSignal({ data, aggregateId: "org_acme" })).toEqual({
      kind: "team_member_invited",
      sourceEventId: "org_acme:invite_1,invite_2",
      tenantId: "org_acme",
      occurredAt: AT,
      userId: "user_admin",
      teamMemberCount: 4,
      roles: ["MEMBER", "ADMIN"],
    });
  });

  /** @scenario "New signup tracks signed_up event" */
  it("raise the sign-up with the questionnaire and the intent", () => {
    const data = {
      ...org,
      userId: "user_admin",
      organizationName: "Acme",
      signUpData: { yourRole: "engineer" },
      primaryIntent: "LLM_OPS",
    };
    expect(signedUpSignal({ data, aggregateId: "org_acme" })).toEqual({
      kind: "signed_up",
      sourceEventId: "org_acme",
      tenantId: "org_acme",
      occurredAt: AT,
      userId: "user_admin",
      organizationId: "org_acme",
      organizationName: "Acme",
      signUpData: { yourRole: "engineer" },
      primaryIntent: "LLM_OPS",
    });
  });

  it("raise the accepted invitation's person and organization", () => {
    const data = { ...org, userId: "user_new", inviteId: "invite_1", organizationName: "Acme" };
    expect(inviteAcceptedSignal({ data, aggregateId: "org_acme" })).toEqual({
      kind: "invite_accepted",
      sourceEventId: "org_acme:invite_1",
      tenantId: "org_acme",
      occurredAt: AT,
      userId: "user_new",
      organizationId: "org_acme",
      organizationName: "Acme",
    });
  });

  /** @scenario "Integration-method identify call is fire-and-forget" */
  it("raise the person's chosen integration method under their own id", () => {
    const data = {
      tenantId: "user_admin",
      userId: "user_admin",
      occurredAt: AT,
      selection: "via-platform" as const,
    };
    expect(integrationMethodChosenSignal({ data, aggregateId: "user_admin" })).toEqual({
      kind: "integration_method_chosen",
      sourceEventId: `user_admin:${AT}`,
      tenantId: "user_admin",
      occurredAt: AT,
      userId: "user_admin",
      selection: "via-platform",
    });
  });
});

describe("a created prompt, workflow or scenario", () => {
  const context = { tenantId: "project-1" };

  /** @scenario "First prompt creation identifies user with has_prompts true" */
  it("raises the prompt and its org-wide count, keyed by the prompt", () => {
    const data = {
      promptId: "prompt-1",
      projectId: "project-1",
      userId: "user-1",
      orgPromptCount: 1,
      occurredAt: AT,
    };
    expect(promptCreatedSignal({ data, aggregateId: "prompt-1", ...context })).toEqual({
      kind: "prompt_created",
      sourceEventId: "prompt-1",
      tenantId: "project-1",
      occurredAt: AT,
      userId: "user-1",
      projectId: "project-1",
      orgPromptCount: 1,
    });
  });

  /** @scenario "Workflow creation updates workflow count and fires event" */
  it("raises the workflow and the project's count, keyed by the workflow", () => {
    const data = {
      workflowId: "workflow-1",
      projectId: "project-1",
      userId: "user-1",
      workflowCount: 2,
      occurredAt: AT,
    };
    expect(workflowCreatedSignal({ data, aggregateId: "workflow-1", ...context })).toEqual({
      kind: "workflow_created",
      sourceEventId: "workflow-1",
      tenantId: "project-1",
      occurredAt: AT,
      userId: "user-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      workflowCount: 2,
    });
  });

  /** @scenario "Scenario creation updates scenario count and fires event" */
  it("raises the scenario, the project's count and the variant, keyed by the scenario", () => {
    const data = {
      scenarioId: "scenario-1",
      projectId: "project-1",
      userId: "user-1",
      scenarioCount: 3,
      onboardingVariant: null,
      occurredAt: AT,
    };
    expect(scenarioCreatedSignal({ data, aggregateId: "scenario-1", ...context })).toEqual({
      kind: "scenario_created",
      sourceEventId: "scenario-1",
      tenantId: "project-1",
      occurredAt: AT,
      userId: "user-1",
      projectId: "project-1",
      scenarioId: "scenario-1",
      scenarioCount: 3,
      onboardingVariant: null,
    });
  });
});

describe("a redelivered owner event", () => {
  it("raises the same signal key, so delivery's claim sends it once", () => {
    const data = { ...org, userId: "user_new", inviteId: "invite_1", organizationName: "Acme" };
    const deliver = () =>
      nurturingSignalKey(inviteAcceptedSignal({ data, aggregateId: "org_acme" }));

    expect(deliver()).toBe(deliver());
    expect(deliver()).toBe("invite_accepted:org_acme:invite_1");
  });
});

describe("a finished connected-agent run", () => {
  const data = {
    scenarioRunId: "run-1",
    scenarioId: "scenario-1",
    target: { type: "connected" as const, referenceId: "agent-1" },
    results: { verdict: "success" as const, metCriteria: [], unmetCriteria: [] },
    status: "SUCCESS",
    organizationAdmin: { userId: "admin-1", onboardingVariant: null },
    occurredAt: AT,
  };

  /** @scenario "a scenario run that finished against a connected agent is tracked as succeeded" */
  it("raises the run against the admin its event carries, keyed by the run", () => {
    expect(
      scenarioRunSucceededSignal({ data, aggregateId: "run-1", tenantId: "project-1" }),
    ).toEqual([
      {
        kind: "scenario_run_succeeded",
        sourceEventId: "run-1",
        tenantId: "project-1",
        occurredAt: AT,
        userId: "admin-1",
        projectId: "project-1",
        scenarioId: "scenario-1",
        runId: "run-1",
        onboardingVariant: null,
      },
    ]);
  });

  it("raises nothing when the event names no admin or carries no instant", () => {
    const run = { aggregateId: "run-1", tenantId: "project-1" };
    expect(
      scenarioRunSucceededSignal({ ...run, data: { ...data, organizationAdmin: undefined } }),
    ).toEqual([]);
    expect(
      scenarioRunSucceededSignal({ ...run, data: { ...data, occurredAt: undefined } }),
    ).toEqual([]);
  });
});

describe("trace's project milestones", () => {
  const trace = {
    tenantId: "project-1",
    projectId: "project-1",
    userId: "admin-1",
    occurredAt: AT,
  };

  it("raise the first trace with its SDK, once per project", () => {
    const data = { ...trace, sdkLanguage: "python", sdkFramework: "openai" };
    expect(firstTraceRecordedSignal({ data, aggregateId: "project-1" })).toEqual({
      kind: "first_trace_integrated",
      sourceEventId: "project-1",
      ...data,
    });
  });

  it("raise a later trace keyed by the project and the trace's instant", () => {
    expect(traceReceivedSignal({ data: trace, aggregateId: "project-1" })).toEqual({
      kind: "trace_received",
      sourceEventId: `project-1:${AT}`,
      ...trace,
    });
  });
});
