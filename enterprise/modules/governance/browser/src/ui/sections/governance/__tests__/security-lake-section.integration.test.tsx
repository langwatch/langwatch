// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Security Lake section: the callers read waits for the organisation and a source.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SecurityLakeSection } from "../security-lake/security-lake-section.tsx";

const calls = vi.hoisted(() => ({
  callers: [] as { input: unknown; options: { enabled?: boolean } | undefined }[],
  tested: [] as unknown[],
  resets: 0,
}));

vi.mock("../../../../behavior/governance-api.ts", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false, data: undefined, variables: null });
  return {
    api: {
      ingestionSources: {
        securityLakeCreate: { useMutation: mutation },
        securityLakeUpdate: { useMutation: mutation },
        securityLakeTestConnection: {
          useMutation: () => ({
            ...mutation(),
            mutate: (input: unknown) => calls.tested.push(input),
            reset: () => {
              calls.resets += 1;
            },
          }),
        },
        securityLakeGet: {
          useQuery: () => ({ data: { externalId: "lw-0123456789abcdef0123456789abcdef" } }),
        },
        securityLakeHealth: { useQuery: () => ({ data: undefined, isLoading: true }) },
        securityLakeCallersWithoutTraces: {
          useQuery: (input: unknown, options?: { enabled?: boolean }) => {
            calls.callers.push({ input, options });
            return { data: undefined, isLoading: false };
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
}) =>
  renderWithGovernanceHost(<SecurityLakeSection canManage onChanged={vi.fn()} {...props} />, {
    host: fakeGovernanceHost(),
  });

beforeEach(() => {
  calls.callers.length = 0;
  calls.tested.length = 0;
  calls.resets = 0;
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
    const resetsBeforeCancel = calls.resets;
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.resets).toBe(resetsBeforeCancel + 1);
    expect(resetsBeforeCancel).toBe(1);
  });
});
