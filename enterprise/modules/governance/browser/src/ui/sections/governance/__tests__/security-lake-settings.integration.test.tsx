// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Security Lake settings: the add and edit form, the health panel and the callers list.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  blankSecurityLakeForm,
  securityLakeFormFromSource,
} from "../../../../model/security-lake-form-state.ts";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SecurityLakeCallersList } from "../security-lake/security-lake-callers-list.tsx";
import { SecurityLakeHealthPanel } from "../security-lake/security-lake-health-panel.tsx";
import { SecurityLakeSourceForm } from "../security-lake/security-lake-source-form.tsx";

afterEach(cleanup);

const render = (element: React.ReactElement) =>
  renderWithGovernanceHost(element, { host: fakeGovernanceHost() });

/** Pastes a whole value into a field: typing it key by key is slow enough to time out. */
async function fill(label: string, value: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.paste(value);
}

const formProps = {
  initialValues: blankSecurityLakeForm(),
  isNew: true,
  isSaving: false,
  onCancel: vi.fn(),
};

describe("SecurityLakeSourceForm", () => {
  /** @scenario The settings form opens with CloudTrail management and data events checked */
  it("opens a new source with every CloudTrail source checked", () => {
    render(<SecurityLakeSourceForm {...formProps} onSubmit={vi.fn()} />);
    for (const label of [
      "CloudTrail management events",
      "CloudTrail S3 data events",
      "CloudTrail Lambda data events",
    ]) {
      expect(screen.getByLabelText(label)).toBeChecked();
    }
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
  });

  /** @scenario The settings form names the malformed fields before it saves */
  it("names the Region and role ARN fields and does not submit", async () => {
    const onSubmit = vi.fn();
    render(<SecurityLakeSourceForm {...formProps} onSubmit={onSubmit} />);
    await fill("Region", "Europe");
    await fill("Subscriber role ARN", "not-an-arn");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(screen.getByText("an AWS Region such as eu-west-1")).toBeInTheDocument();
    expect(screen.getByText("an IAM role ARN")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a complete source with the sources left checked", async () => {
    const onSubmit = vi.fn();
    render(<SecurityLakeSourceForm {...formProps} onSubmit={onSubmit} />);
    await fill("Region", "eu-west-1");
    await fill("Subscriber role ARN", "arn:aws:iam::123456789012:role/subscriber");
    await fill("SQS queue URL", "https://sqs.eu-west-1.amazonaws.com/123456789012/queue");
    await fill("Access key id", "AKIAEXAMPLE");
    await fill("Secret access key", "secret");
    await userEvent.click(screen.getByLabelText("CloudTrail Lambda data events"));
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-west-1", sources: ["CLOUD_TRAIL_MGMT", "S3_DATA"] }),
    );
  });

  it("keeps the endpoint overrides under Advanced and submits them", async () => {
    const onSubmit = vi.fn();
    render(<SecurityLakeSourceForm {...formProps} onSubmit={onSubmit} />);
    expect(screen.queryByLabelText("S3 endpoint")).not.toBeInTheDocument();
    await fill("Region", "eu-west-1");
    await fill("Subscriber role ARN", "arn:aws:iam::123456789012:role/subscriber");
    await fill("SQS queue URL", "https://sqs.eu-west-1.amazonaws.com/123456789012/queue");
    await fill("Access key id", "AKIAEXAMPLE");
    await fill("Secret access key", "secret");
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await fill("S3 endpoint", "not a url");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("S3 endpoint"));
    await fill("S3 endpoint", "https://bucket.vpce.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ s3Endpoint: "https://bucket.vpce.example.com", sqsEndpoint: "" }),
    );
  });

  it("opens Advanced when the saved source has an endpoint override", () => {
    render(
      <SecurityLakeSourceForm
        {...formProps}
        isNew={false}
        initialValues={{ ...blankSecurityLakeForm(), sqsEndpoint: "https://sqs.vpce.example.com" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("SQS endpoint")).toHaveValue("https://sqs.vpce.example.com");
  });

  it("prefills a saved source from the stored config the source list returns", () => {
    const saved = {
      name: "ACME Security Lake",
      parserConfig: {
        region: "eu-west-1",
        subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
        queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-lake",
        sources: ["CLOUD_TRAIL_MGMT"],
        s3Endpoint: "https://s3.vpce.example.com",
        maxMessagesPerRun: 100,
      },
    };
    render(
      <SecurityLakeSourceForm
        {...formProps}
        isNew={false}
        initialValues={securityLakeFormFromSource(saved)}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Region")).toHaveValue("eu-west-1");
    expect(screen.getByLabelText("Subscriber role ARN")).toHaveValue(
      "arn:aws:iam::123456789012:role/acme-lake-subscriber",
    );
    expect(screen.getByLabelText("SQS queue URL")).toHaveValue(
      "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-lake",
    );
    expect(screen.getByLabelText("S3 endpoint")).toHaveValue("https://s3.vpce.example.com");
  });

  /** @scenario Test connection shows the queue backlog in the settings form */
  it("tests a saved source and shows the queue backlog", async () => {
    const onTestConnection = vi.fn();
    const initialValues = securityLakeFormFromSource({
      name: "ACME Security Lake",
      parserConfig: {
        region: "eu-west-1",
        subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
        queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-lake",
        sources: ["CLOUD_TRAIL_MGMT"],
      },
    });
    render(
      <SecurityLakeSourceForm
        {...formProps}
        initialValues={initialValues}
        isNew={false}
        onSubmit={vi.fn()}
        onTestConnection={onTestConnection}
        testResult={{ ok: true, waiting: 2, inFlight: 0, error: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(onTestConnection).toHaveBeenCalledExactlyOnceWith(initialValues);
    expect(screen.getByText("Queue reachable: 2 waiting, 0 in flight")).toBeInTheDocument();
  });

  /** @scenario The settings form shows the generated external id to copy */
  it("shows the generated external id read-only with a copy button on a saved source", () => {
    render(
      <SecurityLakeSourceForm
        {...formProps}
        isNew={false}
        externalId="lw-0123456789abcdef0123456789abcdef"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTitle("lw-0123456789abcdef0123456789abcdef")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy external id" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "External id" })).not.toBeInTheDocument();
  });

  it("asks for no external id on a new source", () => {
    render(<SecurityLakeSourceForm {...formProps} onSubmit={vi.fn()} />);
    expect(screen.queryByText("External id")).not.toBeInTheDocument();
  });

  /** @scenario Pressing Enter while the source saves sends it once */
  it("sends the source once when Enter is pressed twice before the save ends", () => {
    const onSubmit = vi.fn();
    const complete = {
      ...blankSecurityLakeForm(),
      region: "eu-west-1",
      subscriberRoleArn: "arn:aws:iam::123456789012:role/subscriber",
      queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/queue",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    };
    const view = render(
      <SecurityLakeSourceForm {...formProps} initialValues={complete} onSubmit={onSubmit} />,
    );
    const form = screen.getByLabelText("Region").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();

    view.rerender(
      <SecurityLakeSourceForm
        {...formProps}
        initialValues={complete}
        isSaving
        onSubmit={onSubmit}
      />,
    );
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("shows the AWS error when the queue refuses", () => {
    render(
      <SecurityLakeSourceForm
        {...formProps}
        isNew={false}
        onSubmit={vi.fn()}
        onTestConnection={vi.fn()}
        testResult={{ ok: false, waiting: null, inFlight: null, error: "AccessDenied" }}
      />,
    );
    expect(screen.getByText("Queue unreachable: AccessDenied")).toBeInTheDocument();
  });
});

describe("SecurityLakeHealthPanel", () => {
  /** @scenario The settings show the source health with its poison objects */
  it("shows the last error, counts and the poison object", () => {
    render(
      <SecurityLakeHealthPanel
        health={{
          sourceId: "src_1",
          status: "active",
          lastError: "AccessDenied on GetObject",
          health: {
            lastReadAt: Date.UTC(2026, 10, 17, 9, 0),
            lagMs: 5 * 60_000,
            runs: 3,
            messages: 4,
            objects: 4,
            rows: 120,
            written: 12,
            dropped: 108,
            invalid: 0,
            retried: 1,
            poisonCount: 1,
            poison: [{ messageId: "m1", key: "lake/bad.parquet", reason: "corrupt", at: 1 }],
          },
        }}
      />,
    );
    expect(screen.getByText("Last run failed: AccessDenied on GetObject")).toBeInTheDocument();
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.getByText("108")).toBeInTheDocument();
    const poison = screen.getByRole("table", { name: "Poison objects" });
    expect(within(poison).getByText("lake/bad.parquet")).toBeInTheDocument();
  });

  it("shows the last read through the app's date format", () => {
    const { container } = render(
      <SecurityLakeHealthPanel
        health={{
          sourceId: "src_1",
          status: "active",
          lastError: null,
          health: {
            lastReadAt: Date.UTC(2026, 10, 17, 9, 0),
            lagMs: null,
            runs: 1,
            messages: 0,
            objects: 0,
            rows: 0,
            written: 0,
            dropped: 0,
            invalid: 0,
            retried: 0,
            poisonCount: 0,
            poison: [],
          },
        }}
      />,
    );
    expect(container.querySelector('time[datetime="2026-11-17T09:00:00Z"]')).not.toBeNull();
  });
});

describe("given a source whose last read wrote no events", () => {
  const healthAfter = ({ lastReadAt }: { lastReadAt: number | null }) => ({
    sourceId: "src_1",
    status: "active" as const,
    lastError: null,
    health: {
      lastReadAt,
      lagMs: null,
      runs: lastReadAt === null ? 0 : 1,
      messages: 0,
      objects: 0,
      rows: 0,
      written: 0,
      dropped: 0,
      invalid: 0,
      retried: 0,
      poisonCount: 0,
      poison: [],
    },
  });

  /** @scenario "The health card says a read wrote no new events rather than showing no lag" */
  it("says there were no new events instead of a lag of None", () => {
    render(
      <SecurityLakeHealthPanel health={healthAfter({ lastReadAt: Date.UTC(2026, 10, 17) })} />,
    );

    expect(screen.getByText("No new events")).toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  /** @scenario "The health card says a read wrote no new events rather than showing no lag" */
  it("says the source was not read yet before its first read", () => {
    render(<SecurityLakeHealthPanel health={healthAfter({ lastReadAt: null })} />);

    expect(screen.getAllByText("Not read yet")).toHaveLength(2);
  });
});

describe("SecurityLakeCallersList", () => {
  /** @scenario The settings list each caller without traces with its models and Regions */
  it("lists each principal with its models and Regions", () => {
    render(
      <SecurityLakeCallersList
        hasSource
        callers={[
          {
            principalArn: "arn:aws:iam::123456789012:role/agent",
            models: ["anthropic.claude-sonnet", "amazon.titan"],
            regions: ["eu-west-1"],
            lastCallMs: Date.UTC(2026, 10, 16),
            callCount: 42,
          },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Model callers without traces" });
    expect(within(table).getByText("arn:aws:iam::123456789012:role/agent")).toBeInTheDocument();
    expect(within(table).getByText("anthropic.claude-sonnet, amazon.titan")).toBeInTheDocument();
    expect(within(table).getByText("42")).toBeInTheDocument();
    expect(table.querySelector('time[datetime="2026-11-16T00:00:00Z"]')).not.toBeNull();
  });

  it("says every caller sends traces when a source is connected and the list is empty", () => {
    render(<SecurityLakeCallersList hasSource callers={[]} />);
    expect(screen.getByText("Every model caller sends traces")).toBeInTheDocument();
  });

  /** @scenario With no Security Lake source the callers list asks to connect one */
  it("asks to connect a source when none is connected", () => {
    render(<SecurityLakeCallersList hasSource={false} callers={[]} />);
    expect(
      screen.getByText("Connect a Security Lake source to see model callers"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Every model caller sends traces")).not.toBeInTheDocument();
  });
});
