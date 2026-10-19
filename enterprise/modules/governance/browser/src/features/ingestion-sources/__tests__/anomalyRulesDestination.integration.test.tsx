// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The rule form's alert destination: a picker over the organisation's webhook
 * endpoints. Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  rules: [] as Record<string, unknown>[],
  create: vi.fn(),
  update: vi.fn(),
  endpointRequests: [] as { organizationId: string; enabled: boolean }[],
}));

vi.mock("../../../behavior/use-webhook-endpoint-options.ts", () => ({
  useWebhookEndpointOptions: (args: { organizationId: string; enabled: boolean }) => {
    harness.endpointRequests.push(args);
    return {
      options: args.enabled
        ? [
            { value: "wh-ops", label: "https://ops.example.com/hook" },
            { value: "wh-finance", label: "https://finance.example.com/hook" },
          ]
        : [],
      isLoading: false,
    };
  },
}));

vi.mock("../../../behavior/governance-api.ts", () => {
  const mutation = (mutate = vi.fn()) => ({
    useMutation: () => ({
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
      variables: undefined,
      data: undefined,
      error: null,
      reset: vi.fn(),
    }),
  });
  const api = {
    useUtils: () => ({ anomalyRules: { list: { invalidate: vi.fn() } } }),
    anomalyRules: {
      list: { useQuery: () => ({ data: harness.rules, isLoading: false, error: null }) },
      create: mutation(harness.create),
      update: mutation(harness.update),
      archive: mutation(),
    },
    ingestionSources: {
      list: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
    },
  };
  return { api, governanceApi: api };
});

import { AnomalyRulesTab } from "../anomaly-rules-tab";

const INLINE_RULE = {
  id: "rule-inline",
  name: "Spend spike",
  description: null,
  severity: "warning",
  ruleType: "spend_spike",
  scope: "organization",
  scopeId: "org-1",
  status: "active",
  thresholdConfig: {},
  destinationConfig: {
    type: "webhook",
    url: "https://legacy.example.com/alerts",
    sharedSecret: "s",
  },
  createdAt: new Date("2026-01-01").toISOString(),
  updatedAt: new Date("2026-01-01").toISOString(),
  lastTriggeredAt: null,
};

function mount() {
  return renderWithGovernanceHost(<AnomalyRulesTab />, {
    host: fakeGovernanceHost({ permissions: harness.permissions }),
  });
}

async function openNewRule(user: ReturnType<typeof userEvent.setup>) {
  const newRule = (await screen.findAllByRole("button", { name: /New rule/ }))[0];
  if (!newRule) throw new Error("the rules pane has no New rule control");
  await user.click(newRule);
  await screen.findByRole("dialog");
}

beforeEach(() => {
  harness.permissions = ["anomalyRules:view", "anomalyRules:manage", "webhookEndpoints:view"];
  harness.rules = [];
  harness.endpointRequests = [];
  harness.create.mockClear();
  harness.update.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("given an admin composing an anomaly rule", () => {
  /** @scenario "The rule form lists and saves one of the organisation's webhook endpoints" */
  it("saves the picked endpoint by id", async () => {
    const user = userEvent.setup();
    mount();
    await openNewRule(user);

    await user.type(screen.getByPlaceholderText("Display name for this rule"), "Spend spike");
    await user.click(screen.getByRole("combobox", { name: "Alert destination" }));
    expect(
      await screen.findByRole("option", { name: "https://ops.example.com/hook" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "https://finance.example.com/hook" }));
    await user.click(screen.getByRole("button", { name: "Create rule" }));

    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
      destinationConfig: { type: "webhook_endpoint", endpointId: "wh-finance" },
    });
  });

  /** @scenario "The rule form keeps an inline webhook destination readable" */
  it("shows an inline destination's URL and keeps it when saved unchanged", async () => {
    harness.rules = [INLINE_RULE];
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    await screen.findByRole("dialog");

    expect(screen.getByText(/https:\/\/legacy\.example\.com\/alerts/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.update.mock.calls[0]?.[0]).toMatchObject({
      destinationConfig: INLINE_RULE.destinationConfig,
    });
  });

  /** @scenario "Without webhook endpoint read access the rule form shows a no-permission notice" */
  it("shows a no-permission notice and requests no endpoints", async () => {
    harness.permissions = ["anomalyRules:view", "anomalyRules:manage"];
    const user = userEvent.setup();
    mount();
    await openNewRule(user);

    expect(screen.getByText(/Missing permission: webhookEndpoints:view/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Alert destination" })).not.toBeInTheDocument();
    expect(harness.endpointRequests.length).toBeGreaterThan(0);
    expect(harness.endpointRequests.every((request) => !request.enabled)).toBe(true);
  });
});
