/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_TOOL_CARDS } from "../../../../ee/governance/dashboard/components/toolCatalog/sampleToolCards";
import { ToolCatalogCard } from "../../../../ee/governance/dashboard/components/toolCatalog/ToolCatalogCards";
import type { ToolCard } from "../../../../ee/governance/dashboard/components/toolCatalog/toolCards";
import { AgentCard } from "../agents/AgentCard";
import { SAMPLE_AGENT_ROWS } from "../agents/agentRows";

function renderCard(children: ReactNode) {
  return render(
    <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>,
  );
}

function sampleTool(id: string): ToolCard {
  const card = SAMPLE_TOOL_CARDS.find((candidate) => candidate.id === id);
  if (!card) throw new Error(`Missing sample tool: ${id}`);
  return card;
}

afterEach(cleanup);

describe("provider data boundaries", () => {
  describe.each([true, false])("when sample mode is %s", (sample) => {
    /** @scenario Copilot token gaps name the additional telemetry required */
    it("explains which source would supply Copilot tokens", () => {
      const card = sampleTool("sample-copilot-studio");
      renderCard(
        <ToolCatalogCard
          card={{
            ...card,
            isSample: sample,
            values: sample ? card.values : {},
          }}
        />,
      );
      expect(
        screen.getByLabelText(
          /Tokens · 30 days not measured.*additional telemetry source/,
        ),
      ).toHaveTextContent("—");
    });

    /** @scenario Genie token gaps describe the conversation source */
    it("explains why the Genie conversation source has no token count", () => {
      const card = sampleTool("sample-databricks-genie");
      renderCard(
        <ToolCatalogCard
          card={{
            ...card,
            isSample: sample,
            values: sample ? card.values : {},
          }}
        />,
      );
      expect(
        screen.getByLabelText(
          /Tokens · 30 days not measured.*Genie conversation source/,
        ),
      ).toHaveTextContent("—");
    });
  });

  describe("when licence samples have no contract prices", () => {
    /** @scenario Licence samples require contract prices for money figures */
    it("withholds monthly licence and unassigned licence costs", () => {
      const cards = SAMPLE_TOOL_CARDS.filter((card) =>
        card.badges.includes("seatsAndLicences"),
      );
      renderCard(
        <>
          {cards.map((card) => (
            <ToolCatalogCard key={card.id} card={card} />
          ))}
        </>,
      );
      expect(
        screen.getAllByLabelText(
          /Licence per month not measured.*Contract price required/,
        ),
      ).toHaveLength(cards.length);
      expect(
        screen.getAllByLabelText(
          /Unassigned licence cost not measured.*contract price required/,
        ),
      ).toHaveLength(cards.length);
    });

    /** @scenario Licence samples describe assignments rather than activity */
    it("calls the Copilot seat count assigned", () => {
      renderCard(
        <ToolCatalogCard card={sampleTool("sample-copilot-studio")} />,
      );
      expect(screen.getByText("120 of 200 assigned")).toBeInTheDocument();
    });
  });

  describe("when Copilot agents have usage but no dollar calculation", () => {
    /** @scenario Copilot agent samples with usage do not invent a dollar cost */
    it("keeps requests and explains the missing cost", () => {
      const agents = SAMPLE_AGENT_ROWS.filter(
        (agent) => agent.source === "copilot_studio",
      );
      renderCard(
        <>
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} sample />
          ))}
        </>,
      );
      expect(
        screen.getAllByLabelText(
          /Dollar cost per agent needs billing data and a supported calculation/,
        ),
      ).toHaveLength(agents.length);
      expect(screen.getByText("21,800")).toBeInTheDocument();
    });
  });

  describe("when sources report a measured zero", () => {
    /** @scenario A measured zero remains a number */
    it("keeps zero tokens and zero dollars visible", () => {
      const agent = SAMPLE_AGENT_ROWS[0]!;
      const card = sampleTool("sample-copilot-studio");
      renderCard(
        <>
          <ToolCatalogCard card={{ ...card, values: { tokens30Days: 0 } }} />
          <AgentCard agent={{ ...agent, costUsd30d: 0 }} />
        </>,
      );
      expect(screen.getByLabelText("Tokens · 30 days: 0")).toHaveTextContent(
        "0",
      );
      expect(screen.getByText("$0.00")).toBeInTheDocument();
    });
  });
});
