// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Security Lake section: the callers read waits for the organisation and a source.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SecurityLakeSection } from "../security-lake/security-lake-section.tsx";

const calls = vi.hoisted(() => ({
  callers: [] as { input: unknown; options: { enabled?: boolean } | undefined }[],
  tested: [] as unknown[],
  testFailure: null as Error | null,
  readFailure: null as Error | null,
}));

/** A connection-test mutation that keeps its last answer until reset, as the real hook does. */
function useStatefulTestConnection(options?: { onError?: (error: Error) => void }) {
  const [state, setState] = useState<{ variables: unknown; data: unknown } | null>(null);
  return {
    isPending: false,
    data: state?.data,
    variables: state?.variables ?? null,
    mutate: (input: unknown) => {
      calls.tested.push(input);
      if (calls.testFailure !== null) return options?.onError?.(calls.testFailure);
      setState({ variables: input, data: { ok: true, waiting: 3, inFlight: 0 } });
    },
    reset: () => setState(null),
  };
}

vi.mock("../../../../behavior/governance-api.ts", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false, data: undefined, variables: null });
  return {
    api: {
      ingestionSources: {
        securityLakeCreate: { useMutation: mutation },
        securityLakeUpdate: { useMutation: mutation },
        securityLakeTestConnection: {
          useMutation: (options?: { onError?: (error: Error) => void }) =>
            useStatefulTestConnection(options),
        },
        securityLakeGet: {
          useQuery: () => ({ data: { externalId: "lw-0123456789abcdef0123456789abcdef" } }),
        },
        securityLakeHealth: {
          useQuery: () =>
            calls.readFailure === null
              ? { data: undefined, isLoading: true, error: null }
              : { data: undefined, isLoading: false, error: calls.readFailure, refetch: vi.fn() },
        },
        securityLakeCallersWithoutTraces: {
          useQuery: (input: unknown, options?: { enabled?: boolean }) => {
            calls.callers.push({ input, options });
            if (calls.readFailure !== null) {
              return {
                data: undefined,
                isLoading: false,
                error: calls.readFailure,
                refetch: vi.fn(),
              };
            }
            return { data: undefined, isLoading: false, error: null };
          },
        },
      },
    },
  };
});

const lake = {
  id: "src_lake",
  name: "ACME Security Lake",
  sourceType: "security_lake",
  parserConfig: {
    region: "eu-west-1",
    subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-lake",
  },
};

const renderSection = (props: {
  organizationId: string;
  sources: { id: string; name: string; sourceType: string }[] | undefined;
  host?: ReturnType<typeof fakeGovernanceHost>;
}) =>
  renderWithGovernanceHost(
    <SecurityLakeSection
      canManage
      onChanged={vi.fn()}
      organizationId={props.organizationId}
      sources={props.sources}
    />,
    { host: props.host ?? fakeGovernanceHost() },
  );

beforeEach(() => {
  calls.callers.length = 0;
  calls.tested.length = 0;
  calls.testFailure = null;
  calls.readFailure = null;
});
afterEach(cleanup);

describe("SecurityLakeSection", () => {
  it("does not read the callers before the organisation id is known", () => {
    renderSection({ organizationId: "", sources: [lake] });
    expect(calls.callers.length).toBeGreaterThan(0);
    expect(calls.callers.every((call) => call.options?.enabled === false)).toBe(true);
  });

  it("reads the callers once the organisation has a Security Lake source", () => {
    renderSection({ organizationId: "org_1", sources: [lake] });
    expect(calls.callers.at(-1)).toEqual({
      input: { organizationId: "org_1" },
      options: { enabled: true },
    });
  });

  /** @scenario With no Security Lake source the callers list asks to connect one */
  it("asks to connect a source and reads no callers when none is connected", () => {
    renderSection({
      organizationId: "org_1",
      sources: [{ id: "src_other", name: "Other", sourceType: "openai_admin" }],
    });
    expect(calls.callers.length).toBeGreaterThan(0);
    expect(calls.callers.every((call) => call.options?.enabled === false)).toBe(true);
    expect(
      screen.getByText("Connect a Security Lake source to see model callers"),
    ).toBeInTheDocument();
  });

  /** @scenario Test connection sends the values in the form */
  it("tests the queue URL typed in the form and clears the result on cancel and edit", async () => {
    renderSection({ organizationId: "org_1", sources: [lake] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTitle("lw-0123456789abcdef0123456789abcdef")).toBeInTheDocument();
    const queueUrl = "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-fixed";
    await userEvent.clear(screen.getByLabelText("SQS queue URL"));
    await userEvent.type(screen.getByLabelText("SQS queue URL"), queueUrl);
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(calls.tested).toEqual([
      expect.objectContaining({
        organizationId: "org_1",
        id: "src_lake",
        config: expect.objectContaining({ queueUrl }),
      }),
    ]);
    expect(calls.tested[0]).not.toHaveProperty("credentials");
    expect(screen.getByText(/Queue reachable: 3 waiting/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.queryByText(/Queue reachable/)).not.toBeInTheDocument();
  });

  it("names the blank field instead of testing a form the input schema would refuse", async () => {
    renderSection({ organizationId: "org_1", sources: [lake] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Region"));
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(calls.tested).toEqual([]);
    expect(screen.getByLabelText("Region")).toHaveAttribute("aria-invalid", "true");
  });

  it("raises an error toast when the connection test itself fails", async () => {
    const host = fakeGovernanceHost();
    calls.testFailure = new Error("network down");
    renderSection({ organizationId: "org_1", sources: [lake], host });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(calls.tested).toHaveLength(1);
    expect(host.recording.failures).toEqual([
      expect.objectContaining({
        error: calls.testFailure,
        fallbackTitle: "Couldn't test the connection",
      }),
    ]);
  });

  describe("given an organisation without the Enterprise plan", () => {
    const withoutEnterprise = () =>
      fakeGovernanceHost({
        permissions: ["ingestionSources:view", "ingestionSources:manage"],
        plan: { isEnterprise: false, isLoading: false },
      });

    /** @scenario "An organisation without Enterprise is not offered a Security Lake source to add" */
    it("offers no Add Security Lake source and says the plan unlocks it", () => {
      renderSection({ organizationId: "org_1", sources: [], host: withoutEnterprise() });

      expect(
        screen.queryByRole("button", { name: /Add Security Lake source/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("security-lake-enterprise-lock")).toBeInTheDocument();
    });

    /** @scenario "An organisation without Enterprise is not offered a Security Lake source to add" */
    it("offers no Edit on a source it already has", () => {
      renderSection({ organizationId: "org_1", sources: [lake], host: withoutEnterprise() });

      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });
  });

  it("says the callers and the source health could not be read instead of showing none", () => {
    calls.readFailure = new Error("network down");
    renderSection({ organizationId: "org_1", sources: [lake] });

    expect(screen.getByText("Couldn't load the model callers")).toBeInTheDocument();
    expect(screen.queryByText(/Every model caller sends traces/)).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load this source's health")).toBeInTheDocument();
  });
});
