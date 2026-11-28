// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The cloud agent source controls a drawer draws for its custom fields: the AWS connection
 * picker, the region chips and the Google Cloud project rows. Only the tRPC binding is doubled.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import "@testing-library/jest-dom/vitest";
import type { AwsConnectionView } from "@langwatch/enterprise-governance-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerMutation,
  answerQuery,
  assertEveryCallConfigured,
  handledError,
  resetTrpcDouble,
  trpcDouble,
} from "../../../../features/kill-switch/__tests__/kill-switch-api-double.tsx";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { cloudAgentCustomControl } from "../inventory/cloud-agent-source-controls.tsx";
import type { FieldDef } from "../inventory/parser-field-controls.ts";

vi.mock("../../../../behavior/governance-api.ts", async () =>
  (
    await import("../../../../features/kill-switch/__tests__/kill-switch-api-double.tsx")
  ).governanceApiDouble(),
);

const PROD: AwsConnectionView = {
  id: "awsconn-1",
  name: "ACME prod",
  accessKeyIdLastFour: "0001",
  roleArn: null,
  externalId: null,
  createdAt: "2026-11-16T00:00:00.000Z",
};
const STAGING: AwsConnectionView = {
  id: "awsconn-2",
  name: "ACME staging",
  accessKeyIdLastFour: null,
  roleArn: "arn:aws:iam::123456789012:role/langwatch-discovery",
  externalId: "langwatch-external-id",
  createdAt: "2026-11-17T00:00:00.000Z",
};

const Control = cloudAgentCustomControl({ organizationId: "org-1" });

/** One custom field holding its string the way the source form holds it. */
function Field({
  fieldKey,
  initial,
  onValue,
}: {
  fieldKey: string;
  initial: string;
  onValue: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const field: FieldDef = { key: fieldKey, label: fieldKey, placeholder: "", control: "custom" };
  return (
    <Control
      field={field}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      isInvalid={false}
      readOnly={false}
    />
  );
}

function renderField({ fieldKey, initial = "" }: { fieldKey: string; initial?: string }) {
  const values: string[] = [];
  renderWithGovernanceHost(
    <Field fieldKey={fieldKey} initial={initial} onValue={(value) => values.push(value)} />,
    { host: fakeGovernanceHost() },
  );
  return { values, last: () => values.at(-1) };
}

beforeEach(() => {
  resetTrpcDouble();
});

afterEach(() => {
  assertEveryCallConfigured();
  cleanup();
});

describe("the AWS regions control", () => {
  /** @scenario "The AWS source form refuses a region code before it adds it" */
  it("refuses a value that is not a region code and keeps the regions as they were", async () => {
    const field = renderField({ fieldKey: "regions", initial: "eu-west-1" });

    await userEvent.type(screen.getByLabelText("Regions"), "not-a-region{Enter}");

    expect(await screen.findByTestId("aws-regions-refused")).toHaveTextContent(
      "Use a region code such as eu-west-1.",
    );
    // The chips clear the refused text on the next frame; the complaint stays until new typing.
    await waitFor(() => expect(screen.getByLabelText("Regions")).toHaveValue(""));
    expect(screen.getByTestId("aws-regions-refused")).toBeVisible();
    expect(field.values).toEqual([]);
  });

  /** @scenario "The AWS source form refuses a region code before it adds it" */
  it("adds a typed region code and a suggested one", async () => {
    const field = renderField({ fieldKey: "regions", initial: "eu-west-1" });

    await userEvent.type(screen.getByLabelText("Regions"), "eu-north-1{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "us-east-1" }));

    expect(field.last()).toBe("eu-west-1, eu-north-1, us-east-1");
    expect(screen.queryByTestId("aws-regions-refused")).toBeNull();
  });

  /** @scenario "An AWS source holding a value that is not a region code says to remove it" */
  it("names a stored value that is not a region code until it is removed", () => {
    renderField({ fieldKey: "regions", initial: "eu-west-1, mars-1" });

    expect(screen.getByTestId("aws-regions-stale")).toHaveTextContent(
      "mars-1 is not a region code. Remove it to save.",
    );
  });
});

describe("the Google Cloud projects control", () => {
  /** @scenario "The Google Cloud source form adds and removes project rows" */
  it("adds a row, removes one and flags a row missing its location", async () => {
    const field = renderField({ fieldKey: "targets" });

    await userEvent.type(screen.getByLabelText("Project 1"), "acme-ml");
    await userEvent.type(screen.getByLabelText("Location 1"), "europe-west4");
    expect(screen.queryByRole("button", { name: "Remove project 1" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await userEvent.type(screen.getByLabelText("Project 2"), "acme-eu");

    expect(await screen.findByTestId("vertex-target-error-1")).toHaveTextContent(
      "Enter a project id and a location such as europe-west4.",
    );
    expect(JSON.parse(field.last() ?? "[]")).toEqual([
      { projectId: "acme-ml", location: "europe-west4" },
      { projectId: "acme-eu", location: "" },
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Remove project 2" }));

    expect(JSON.parse(field.last() ?? "[]")).toEqual([
      { projectId: "acme-ml", location: "europe-west4" },
    ]);
    expect(screen.queryByLabelText("Project 2")).toBeNull();
  });
});

describe("the AWS connection picker", () => {
  /** @scenario "The AWS connection picker lists the organisation's connections" */
  it("offers each connection by name, a role or the key it ends with", async () => {
    answerQuery("governanceKillSwitch.awsConnections", () => [PROD, STAGING]);
    renderField({ fieldKey: "awsConnectionId" });

    await userEvent.click(await screen.findByRole("combobox", { name: "AWS connection" }));

    expect(
      await screen.findByRole("option", { name: "ACME prod (key ending 0001)" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "ACME staging (role)" })).toBeVisible();
  });

  /** @scenario "The AWS connection picker lists the organisation's connections" */
  it("says there is no connection yet when the organisation has none", async () => {
    answerQuery("governanceKillSwitch.awsConnections", () => []);
    renderField({ fieldKey: "awsConnectionId" });

    expect(
      await screen.findByText("No AWS connection yet. Add one to let this source sign in."),
    ).toBeVisible();
  });

  /** @scenario "The AWS connection picker says when the connections did not load and reads them again" */
  it("shows a failed read with Try again and reads again on it", async () => {
    let reads = 0;
    answerQuery("governanceKillSwitch.awsConnections", () => {
      reads += 1;
      if (reads === 1) throw handledError({ code: "service_unavailable", httpStatus: 503 });
      return [PROD];
    });
    renderField({ fieldKey: "awsConnectionId" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load AWS connections");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("combobox", { name: "AWS connection" })).toBeVisible();
    expect(reads).toBe(2);
  });

  /** @scenario "The AWS connection picker adds a connection without leaving the form and picks it" */
  it("adds a connection inline and picks the one it added", async () => {
    let held: AwsConnectionView[] = [];
    answerQuery("governanceKillSwitch.awsConnections", () => held);
    answerMutation("governanceKillSwitch.createAwsConnection", () => {
      held = [PROD];
      return PROD;
    });
    const field = renderField({ fieldKey: "awsConnectionId" });

    await userEvent.click(await screen.findByRole("button", { name: "Add AWS connection" }));
    const form = await screen.findByTestId("aws-connection-form");
    await userEvent.type(within(form).getByLabelText("Connection name"), "ACME prod");
    await userEvent.type(within(form).getByLabelText("Access key id"), "AKIAACMEEXAMPLE0001");
    await userEvent.type(within(form).getByLabelText("Secret access key"), "acme-secret-0001");
    await userEvent.click(within(form).getByRole("button", { name: "Add connection" }));

    await waitFor(() => expect(field.last()).toBe("awsconn-1"));
    expect(screen.queryByTestId("aws-connection-form")).toBeNull();
    expect(trpcDouble.calls.map(({ procedure }) => procedure)).toEqual([
      "governanceKillSwitch.createAwsConnection",
    ]);
    expect(await screen.findByRole("combobox", { name: "AWS connection" })).toHaveTextContent(
      "ACME prod (key ending 0001)",
    );
  });

  /** @scenario "The AWS connection picker adds a connection without leaving the form and picks it" */
  it("leaves the value alone when the person cancels the new connection", async () => {
    answerQuery("governanceKillSwitch.awsConnections", () => [PROD]);
    const field = renderField({ fieldKey: "awsConnectionId" });

    await userEvent.click(await screen.findByRole("button", { name: "Add AWS connection" }));
    const form = await screen.findByTestId("aws-connection-form");
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId("aws-connection-form")).toBeNull();
    expect(field.values).toEqual([]);
    expect(trpcDouble.calls).toEqual([]);
  });
});
