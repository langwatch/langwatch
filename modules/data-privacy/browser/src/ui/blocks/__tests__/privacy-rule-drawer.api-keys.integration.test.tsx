import {
  type DataPrivacyAudienceOptions,
  type DataPrivacyRule,
  PLATFORM_DEFAULT_DATA_PRIVACY,
} from "@langwatch/data-privacy-contract";
/**
 * @vitest-environment jsdom
 *
 * ADR-208: the audience picker offers the organization's API keys by name, under
 * "API keys", with a line saying a picked key sees what Admins see.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivacyRuleDrawer } from "../privacy-rule-drawer.tsx";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const OPTIONS: DataPrivacyAudienceOptions = {
  groups: [],
  apiKeys: [
    { id: "key-nightly", name: "Nightly eval runner" },
    { id: "key-agent", name: "Trace analysis agent" },
  ],
  canAddApiKeys: true,
};

const RULE: DataPrivacyRule = {
  scopeType: "PROJECT",
  scopeId: "proj-1",
  personalOnly: false,
  name: "Web App",
  config: { categories: { input: { disposition: "restrict", audience: { admins: true } } } },
};

function renderDrawer(onSave = vi.fn(), { options = OPTIONS, rule = RULE } = {}) {
  render(
    <PrivacyRuleDrawer
      open={true}
      editingRule={rule}
      onClose={vi.fn()}
      available={{ organization: null, departments: [], teams: [], projects: [] }}
      audienceOptions={options}
      effectiveTeam={PLATFORM_DEFAULT_DATA_PRIVACY}
      effectiveOrganization={PLATFORM_DEFAULT_DATA_PRIVACY}
      projectId="proj-1"
      isSaving={false}
      onSave={onSave}
      scopePicker={() => null}
    />,
    { wrapper },
  );
  return onSave;
}

afterEach(cleanup);

describe("PrivacyRuleDrawer API keys in the audience", () => {
  /** @scenario The audience picker lists the organization's keys by name */
  it("offers the organization's keys by name under API keys, with the explainer", async () => {
    renderDrawer();
    await userEvent.setup().click(screen.getByLabelText("Restricted content is visible to"));

    expect(await screen.findByText("API keys")).toBeInTheDocument();
    expect(
      screen.getByText(
        "For an agent or script that must read this content. It sees what Admins see.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Trace analysis agent" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Nightly eval runner" })).toBeInTheDocument();
  });

  it("offers an editor who may not add keys only the keys this rule already names", async () => {
    renderDrawer(vi.fn(), {
      options: { ...OPTIONS, canAddApiKeys: false },
      rule: {
        ...RULE,
        config: {
          categories: {
            input: {
              disposition: "restrict",
              audience: { admins: true, apiKeyIds: ["key-agent"] },
            },
          },
        },
      },
    });
    await userEvent.setup().click(screen.getByLabelText("Restricted content is visible to"));

    expect(await screen.findByRole("option", { name: "Trace analysis agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Nightly eval runner" })).not.toBeInTheDocument();
  });

  it("names a key that is no longer live the same way in the picker and the line under it", async () => {
    renderDrawer(vi.fn(), {
      rule: {
        ...RULE,
        config: {
          categories: {
            input: { disposition: "restrict", audience: { admins: true, apiKeyIds: ["key-gone"] } },
          },
        },
      },
    });
    expect(screen.getByText("Visible to: Admins, an API key no longer live")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByLabelText("Restricted content is visible to"));
    expect(
      await screen.findByRole("option", { name: "API key no longer live" }),
    ).toBeInTheDocument();
  });

  /** @scenario The picker says when the API keys could not be loaded */
  it("keeps a named key as named, not gone, when the key list could not be read", async () => {
    renderDrawer(vi.fn(), {
      options: { ...OPTIONS, apiKeys: [], apiKeysUnavailable: true },
      rule: {
        ...RULE,
        config: {
          categories: {
            input: {
              disposition: "restrict",
              audience: { admins: true, apiKeyIds: ["key-agent"] },
            },
          },
        },
      },
    });
    await userEvent.setup().click(screen.getByLabelText("Restricted content is visible to"));
    expect(
      await screen.findByRole("option", { name: "API key whose name could not be loaded" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "API key no longer live" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario The picker says when the API keys could not be loaded */
  it("says the keys could not be loaded when the list failed and the rule names none", async () => {
    renderDrawer(vi.fn(), { options: { ...OPTIONS, apiKeys: [], apiKeysUnavailable: true } });
    await userEvent.setup().click(screen.getByLabelText("Restricted content is visible to"));
    expect(
      await screen.findByRole("option", {
        name: "API keys could not be loaded. Try again shortly",
      }),
    ).toBeInTheDocument();
  });

  /** @scenario A key named in the audience sees restricted content */
  it("saves the picked key into the restricted category's audience", async () => {
    const onSave = renderDrawer();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Restricted content is visible to"));
    await user.click(await screen.findByRole("option", { name: "Trace analysis agent" }));
    await user.keyboard("{Escape}");

    expect(
      screen.getByText("Visible to: Admins, API key Trace analysis agent"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith([{ scopeType: "PROJECT", scopeId: "proj-1" }], {
      categories: {
        input: { disposition: "restrict", audience: { admins: true, apiKeyIds: ["key-agent"] } },
      },
    });
  });
});
