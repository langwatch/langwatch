// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/** What a catalog card promises about a source's data, and what it refuses to invent. */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SAMPLE_TOOL_CARDS } from "../sample-tool-cards.ts";
import type { ToolCard } from "../tool-cards.ts";
import { ToolCatalogCard } from "../tool-catalog-cards.tsx";

afterEach(cleanup);

const sample = (id: string): ToolCard => {
  const found = SAMPLE_TOOL_CARDS.find((card) => card.id === id);
  if (!found) throw new Error(`no sample card ${id}`);
  return found;
};

const renderCard = (card: ToolCard) => {
  renderWithGovernanceHost(<ToolCatalogCard card={card} />, { host: fakeGovernanceHost() });
  return screen.getByTestId(`tool-card-${card.id}`);
};

describe("given the Copilot Studio sample card", () => {
  /** @scenario "Copilot token gaps name the additional telemetry required" */
  it("shows tokens as a dash saying an additional telemetry source is required", () => {
    const card = renderCard(sample("sample-copilot-studio"));

    expect(within(card).getByLabelText(/^Tokens · 30 days not measured\./)).toHaveAccessibleName(
      /additional telemetry source/,
    );
  });

  /** @scenario "Licence samples describe assignments rather than activity" */
  it("says its seats are assigned rather than active", () => {
    const card = renderCard(sample("sample-copilot-studio"));

    expect(card).toHaveTextContent("120 of 200 assigned");
    expect(card.textContent).not.toMatch(/active/i);
  });

  /** @scenario "Copilot agent samples with usage do not invent a dollar cost" */
  it("shows usage as a dash needing billing data and keeps the conversation counts visible", () => {
    const card = renderCard(sample("sample-copilot-studio"));

    expect(within(card).getByLabelText(/^Usage · 30 days not measured\./)).toHaveAccessibleName(
      /requires billing data/,
    );
    expect(card).toHaveTextContent("18,720");
    expect(card.textContent).not.toMatch(/\$\d/);
  });
});

describe("given the Databricks Genie sample card", () => {
  /** @scenario "Genie token gaps describe the conversation source" */
  it("shows tokens as a dash saying the conversation source does not report them", () => {
    const card = renderCard(sample("sample-databricks-genie"));

    expect(within(card).getByLabelText(/^Tokens · 30 days not measured\./)).toHaveAccessibleName(
      /conversation source/,
    );
  });
});

describe("given sample licence counts with no contract price", () => {
  /** @scenario "Licence samples require contract prices for money figures" */
  it.each([
    "sample-copilot-studio",
    "sample-github-copilot",
    "sample-chatgpt-enterprise",
    "sample-cursor",
  ])("shows the licence costs on %s as dashes requiring a contract price", (id) => {
    const card = renderCard(sample(id));

    expect(within(card).getByLabelText(/^Licence per month not measured\./)).toHaveAccessibleName(
      /Contract price required/,
    );
    expect(
      within(card).getByLabelText(/^Unassigned licence cost not measured\./),
    ).toHaveAccessibleName(/contract price required/);
  });
});

describe("given a tool reporting zero tokens", () => {
  /** @scenario "A measured zero remains a number" */
  it("keeps the zero visible as a number rather than a dash", () => {
    const card = renderCard({
      ...sample("sample-custom-agents"),
      id: "zero-tokens",
      values: { tokens30Days: 0 },
    });

    expect(within(card).getByLabelText("Tokens · 30 days: 0")).toHaveTextContent("0");
    expect(within(card).queryByLabelText(/^Tokens · 30 days not measured/)).toBeNull();
  });
});
