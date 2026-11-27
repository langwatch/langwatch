// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Stop dialog, which names the plan's targets and asks why, and the stop plan dialog. Confirm
 * and Save wait for the plan read; a failed read shows with Retry. Only the tRPC binding is
 * doubled. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerMutation,
  answerQuery,
  handledError,
  neverAnswers,
  assertEveryCallConfigured,
  resetTrpcDouble,
  trpcDouble,
} from "./kill-switch-api-double.tsx";
import {
  answerAgentsPage,
  failureCodes,
  MANAGER,
  openActions,
  openPlanDialog,
  openStopDialog,
  renderAgentsPage,
  stopOf,
  summary,
  SUPPORT_BOT_PLAN,
} from "./kill-switch-fixtures.tsx";

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("../../../behavior/governance-api.ts", async () =>
  (await import("./kill-switch-api-double.tsx")).governanceApiDouble(),
);

const STOPPING = stopOf({
  id: "stop-9",
  agentId: "a1",
  agentName: "support-bot",
  status: "stopping",
});
const unavailable = () => {
  throw handledError({ code: "service_unavailable", httpStatus: 503 });
};
const stopButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Stop agent" });
const typeReason = (dialog: HTMLElement) =>
  userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Leaking data");

beforeEach(() => {
  window.sessionStorage.clear();
  resetTrpcDouble();
  answerAgentsPage();
});

afterEach(() => {
  cleanup();
  assertEveryCallConfigured();
});

describe("the Stop button of an agent with a stop plan", () => {
  /** @scenario "The Stop button asks for confirmation before stopping" */
  it("names the plan's targets and asks for a reason", async () => {
    const { dialog } = await openStopDialog();

    const targets = await within(dialog).findByTestId("stop-agent-targets");
    expect(targets).toHaveTextContent("support-bot-prod (Databricks serving endpoint)");
    expect(targets).toHaveTextContent("Support key (Gateway virtual key)");
    expect(within(dialog).getByRole("textbox", { name: "Reason" })).toBeInTheDocument();
    expect(trpcDouble.calls).toEqual([]);
  });

  /** @scenario "The Stop button asks for confirmation before stopping" */
  it("requests the stop with the reason and the target ids it showed", async () => {
    answerMutation("governanceKillSwitch.requestStop", () => STOPPING);
    const { dialog } = await openStopDialog();
    await within(dialog).findByTestId("stop-agent-targets");

    await typeReason(dialog);
    await userEvent.click(stopButton(dialog));

    expect(trpcDouble.calls).toEqual([
      {
        procedure: "governanceKillSwitch.requestStop",
        input: {
          organizationId: "org-1",
          agentId: "a1",
          reason: "Leaking data",
          expectedTargetIds: ["t1", "t2"],
        },
      },
    ]);
    expect(trpcDouble.invalidated).toContain("governanceKillSwitch.summaries");
  });

  it("refuses to stop without a reason and says why", async () => {
    const { dialog } = await openStopDialog();
    await within(dialog).findByTestId("stop-agent-targets");

    await userEvent.click(stopButton(dialog));

    expect(trpcDouble.calls).toEqual([]);
    expect(within(dialog).getByText("Say why you are stopping this agent.")).toBeInTheDocument();
  });

  it("keeps Stop agent shut while the plan loads", async () => {
    answerQuery("governanceKillSwitch.plan", neverAnswers);
    const { dialog } = await openStopDialog();

    await typeReason(dialog);
    expect(stopButton(dialog)).toBeDisabled();
    expect(within(dialog).queryByTestId("stop-agent-targets")).toBeNull();
    expect(trpcDouble.calls).toEqual([]);
  });

  it("shows a failed plan read with Retry instead of a plan of no targets", async () => {
    answerQuery("governanceKillSwitch.plan", unavailable);
    const { dialog } = await openStopDialog();

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the stop plan");
    expect(within(dialog).queryByText(/This stops 0 targets/)).toBeNull();
    expect(stopButton(dialog)).toBeDisabled();

    answerQuery("governanceKillSwitch.plan", () => SUPPORT_BOT_PLAN);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByTestId("stop-agent-targets")).toHaveTextContent(
      "Support key",
    );
    expect(stopButton(dialog)).toBeEnabled();
  });

  it("reads the plan again when it changed since it was shown, and asks to confirm again", async () => {
    answerMutation("governanceKillSwitch.requestStop", () => {
      throw handledError({ code: "agent_stop_plan_changed", httpStatus: 409 });
    });
    const { dialog } = await openStopDialog();
    await within(dialog).findByTestId("stop-agent-targets");
    const edited = { ...SUPPORT_BOT_PLAN, targets: SUPPORT_BOT_PLAN.targets.slice(0, 1) };
    answerQuery("governanceKillSwitch.plan", () => edited);

    await typeReason(dialog);
    await userEvent.click(stopButton(dialog));

    expect(await within(dialog).findByText("The stop plan changed")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByTestId("stop-agent-targets")).not.toHaveTextContent("Support key"),
    );
    expect(within(dialog).getByText("This stops 1 target")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Stop support-bot?" })).toBeInTheDocument();
  });

  it("keeps Stop shut for an agent with no stop plan, saying why", async () => {
    answerQuery("governanceKillSwitch.summaries", () => [
      summary({ agentId: "a1", planTargetCount: 0 }),
    ]);
    renderAgentsPage({ permissions: MANAGER });
    await openActions("support-bot");

    const stop = await screen.findByRole("menuitem", { name: /Add a stop plan first/ });
    expect(stop).toHaveAttribute("data-disabled");
  });
});

describe("the stop plan of an agent", () => {
  it("saves the plan without a removed target", async () => {
    answerMutation("governanceKillSwitch.setPlan", () => SUPPORT_BOT_PLAN);
    const { dialog } = await openPlanDialog();

    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Remove Support key" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    expect(trpcDouble.calls).toEqual([
      {
        procedure: "governanceKillSwitch.setPlan",
        input: {
          organizationId: "org-1",
          agentId: "a1",
          targets: [SUPPORT_BOT_PLAN.targets[0]?.target],
          expectedVersion: 3,
        },
      },
    ]);
    expect(trpcDouble.invalidated).toContain("governanceKillSwitch.plan");
  });

  /** @scenario "Saving a stop plan someone else saved since shows their plan" */
  it("says someone else saved the plan and shows their plan instead of overwriting it", async () => {
    answerMutation("governanceKillSwitch.setPlan", () => {
      throw handledError({ code: "agent_stop_plan_conflict", httpStatus: 409 });
    });
    const { dialog } = await openPlanDialog();
    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Remove Support key" }),
    );
    const theirs = {
      ...SUPPORT_BOT_PLAN,
      version: 4,
      targets: SUPPORT_BOT_PLAN.targets.slice(1),
    };
    answerQuery("governanceKillSwitch.plan", () => theirs);

    await userEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    expect(await within(dialog).findByText("Someone else saved this stop plan")).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByTestId("stop-plan-target")
          .map((row) => row.textContent),
      ).toEqual([expect.stringContaining("Support key")]),
    );
    expect(trpcDouble.calls).toEqual([
      {
        procedure: "governanceKillSwitch.setPlan",
        input: expect.objectContaining({ expectedVersion: 3 }),
      },
    ]);
    expect(screen.getByRole("dialog", { name: "Stop plan for support-bot" })).toBeInTheDocument();
  });

  it("shows a failed plan read with Retry and never saves an empty plan", async () => {
    answerQuery("governanceKillSwitch.plan", unavailable);
    const { dialog } = await openPlanDialog();

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the stop plan");
    expect(within(dialog).queryByTestId("stop-target-form")).toBeNull();
    const save = within(dialog).getByRole("button", { name: "Save plan" });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(trpcDouble.calls).toEqual([]);

    answerQuery("governanceKillSwitch.plan", () => SUPPORT_BOT_PLAN);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findAllByTestId("stop-plan-target")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Save plan" })).toBeEnabled();
  });

  /** @scenario "The stop plan dialog offers the organisation's Databricks Genie sources" */
  it("offers a Databricks Genie source in the serving endpoint target's picker", async () => {
    answerQuery("governanceAgents.syncSources", () => [
      {
        id: "src-genie",
        name: "Databricks prod",
        sourceType: "databricks_genie",
        lastListing: null,
      },
    ]);
    const { dialog } = await openPlanDialog();

    await userEvent.click(
      await within(dialog).findByRole("combobox", { name: "Databricks source" }),
    );

    expect(await screen.findByRole("option", { name: "Databricks prod" })).toBeInTheDocument();
  });

  /** @scenario "The stop plan dialog shows a failed source or connection read with Retry" */
  it("says the Databricks sources did not load instead of offering none, and reads them on Retry", async () => {
    answerQuery("governanceAgents.syncSources", unavailable);
    const { dialog } = await openPlanDialog();

    const alert = await within(dialog).findByText("Couldn't load the Databricks sources");
    expect(alert).toBeInTheDocument();
    const reads = trpcDouble.reads.filter((read) => read === "governanceAgents.syncSources");
    answerQuery("governanceAgents.syncSources", () => []);
    const retry = within(dialog).getAllByRole("button", { name: "Try again" }).at(0);
    if (!retry) throw new Error("no Try again button");
    await userEvent.click(retry);

    await waitFor(() =>
      expect(within(dialog).queryByText("Couldn't load the Databricks sources")).toBeNull(),
    );
    expect(
      trpcDouble.reads.filter((read) => read === "governanceAgents.syncSources").length,
    ).toBeGreaterThan(reads.length);
  });

  /** @scenario "The stop plan dialog takes no edit while a save runs" */
  it("turns Add and Remove off while the save and its re-read run", async () => {
    answerMutation("governanceKillSwitch.setPlan", () => SUPPORT_BOT_PLAN);
    const { dialog } = await openPlanDialog();
    await within(dialog).findAllByTestId("stop-plan-target");
    answerQuery("governanceKillSwitch.plan", neverAnswers);

    await userEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(trpcDouble.invalidated).toContain("governanceKillSwitch.plan"));

    expect(within(dialog).getByRole("button", { name: "Remove Support key" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Add target" })).toBeDisabled();
    expect(within(dialog).getAllByTestId("stop-plan-target")).toHaveLength(2);
  });

  it("refuses a target with an empty field and says why", async () => {
    const { dialog } = await openPlanDialog();

    await userEvent.click(await within(dialog).findByRole("button", { name: "Add target" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Fill in every field of the target.",
    );
    expect(within(dialog).getAllByTestId("stop-plan-target")).toHaveLength(2);
  });

  describe("when a person adds an AWS connection", () => {
    const CREATED = {
      id: "aws-2",
      name: "Bedrock prod",
      accessKeyIdLastFour: null,
      roleArn: null,
      externalId: null,
      createdAt: "2026-11-16T00:00:00.000Z",
    };
    const openConnectionForm = async () => {
      const { dialog } = await openPlanDialog();
      await userEvent.click(await within(dialog).findByRole("button", { name: "Add connection" }));
      const form = await within(dialog).findByTestId("aws-connection-form");
      await userEvent.type(within(form).getByLabelText("Connection name"), "Bedrock prod");
      return form;
    };
    const submit = (form: HTMLElement) =>
      userEvent.click(within(form).getByRole("button", { name: "Add connection" }));

    /** @scenario "The AWS connection form adds a key pair or a role to assume" */
    it("sends a trimmed access key pair and nothing of the role", async () => {
      answerMutation("governanceKillSwitch.createAwsConnection", () => CREATED);
      const form = await openConnectionForm();

      await userEvent.type(within(form).getByLabelText("Access key id"), "  AKIAACMEEXAMPLE0001 ");
      await userEvent.type(
        within(form).getByLabelText("Secret access key"),
        "acme-secret-access-key-0001",
      );
      await submit(form);

      expect(trpcDouble.calls).toEqual([
        {
          procedure: "governanceKillSwitch.createAwsConnection",
          input: {
            organizationId: "org-1",
            connection: {
              name: "Bedrock prod",
              accessKeyId: "AKIAACMEEXAMPLE0001",
              secretAccessKey: "acme-secret-access-key-0001",
            },
          },
        },
      ]);
      expect(trpcDouble.invalidated).toContain("governanceKillSwitch.awsConnections");
    });

    /** @scenario "The AWS connection form adds a key pair or a role to assume" */
    it("sends a role ARN with no key pair and no external id, which LangWatch generates", async () => {
      answerMutation("governanceKillSwitch.createAwsConnection", () => CREATED);
      const form = await openConnectionForm();

      await userEvent.type(within(form).getByLabelText("Access key id"), "AKIAACMEEXAMPLE0001");
      await userEvent.click(within(form).getByText("Role to assume"));
      await userEvent.type(
        within(form).getByLabelText("Role ARN"),
        "arn:aws:iam::123456789012:role/langwatch-kill-switch",
      );
      expect(within(form).queryByLabelText("External id")).toBeNull();
      await submit(form);

      expect(trpcDouble.calls).toEqual([
        {
          procedure: "governanceKillSwitch.createAwsConnection",
          input: {
            organizationId: "org-1",
            connection: {
              name: "Bedrock prod",
              roleArn: "arn:aws:iam::123456789012:role/langwatch-kill-switch",
            },
          },
        },
      ]);
    });

    /** @scenario "The AWS connection form adds a key pair or a role to assume" */
    it("keeps Cancel shut until the connections are read again", async () => {
      answerMutation("governanceKillSwitch.createAwsConnection", () => CREATED);
      const form = await openConnectionForm();
      await userEvent.type(within(form).getByLabelText("Access key id"), "AKIAACMEEXAMPLE0001");
      await userEvent.type(
        within(form).getByLabelText("Secret access key"),
        "acme-secret-access-key-0001",
      );
      answerQuery("governanceKillSwitch.awsConnections", neverAnswers);

      await submit(form);

      await waitFor(() =>
        expect(trpcDouble.invalidated).toContain("governanceKillSwitch.awsConnections"),
      );
      expect(within(form).getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    /** @scenario "The AWS connection form refuses a connection the contract would refuse" */
    it("refuses an access key id without its secret, says why and sends nothing", async () => {
      const form = await openConnectionForm();

      await userEvent.type(within(form).getByLabelText("Access key id"), "AKIAACMEEXAMPLE0001");
      await submit(form);

      expect(within(form).getByRole("alert")).toHaveTextContent(
        "an access key id and its secret come together",
      );
      expect(trpcDouble.calls).toEqual([]);
    });

    /** @scenario "The AWS connection form refuses a connection the contract would refuse" */
    it("refuses a role ARN that is not an IAM role and sends nothing", async () => {
      const form = await openConnectionForm();

      await userEvent.click(within(form).getByText("Role to assume"));
      await userEvent.type(within(form).getByLabelText("Role ARN"), "not-an-arn");
      await submit(form);

      expect(within(form).getByRole("alert")).toHaveTextContent("an IAM role ARN");
      expect(trpcDouble.calls).toEqual([]);
    });
  });

  it("says why an AWS connection still in use cannot be deleted", async () => {
    answerQuery("governanceKillSwitch.awsConnections", () => [
      {
        id: "aws-1",
        name: "Bedrock prod",
        accessKeyIdLastFour: "WXYZ",
        roleArn: null,
        externalId: null,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
    answerMutation("governanceKillSwitch.deleteAwsConnection", () => {
      throw handledError({ code: "governance_aws_connection_in_use", httpStatus: 409 });
    });
    const { host, dialog } = await openPlanDialog();

    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Delete Bedrock prod" }),
    );

    await waitFor(() => expect(failureCodes(host)).toEqual(["governance_aws_connection_in_use"]));
    expect(within(dialog).getByTestId("aws-connection-row")).toHaveTextContent("Bedrock prod");
  });
});
