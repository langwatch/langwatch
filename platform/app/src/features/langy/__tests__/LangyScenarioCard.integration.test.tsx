/**
 * @vitest-environment jsdom
 *
 * The scenario card reads the scenario, not its serialised form. A
 * `scenario get` returns a structured document, and the card used to summarise
 * it by stringifying it — so the reader got `{` and `"id": "scenario_0002Yw…",`
 * where the scenario's own name and status belong.
 *
 * @see specs/langy/langy-capability-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";
import { LangyScenarioCard } from "../components/capabilities/LangyScenarioCard";

/** The payload `langwatch scenario get --format json` hands the panel. */
const scenarioPayload = {
  id: "scenario_0002YwLaq1oHu25iNvSTRDLGq0SAt",
  name: "Free-plan refund limit",
  status: "passed",
  situation:
    "The customer for account acme-free asks for an 80 dollar refund on delivered order A-1002.",
  criteria: [
    "The agent verifies order A-1002 before deciding whether to refund",
  ],
  labels: ["support", "refunds"],
};

function renderCard(output: unknown) {
  const descriptor = resolveCapability("langwatch.scenario.get");
  if (!descriptor) throw new Error("no descriptor for langwatch.scenario.get");
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyScenarioCard
        descriptor={descriptor}
        input={{
          command: "langwatch scenario get scenario_0002Yw --format json",
        }}
        output={output}
        projectSlug="acme"
      />
    </ChakraProvider>,
  );
}

describe("LangyScenarioCard", () => {
  describe("given a structured scenario payload", () => {
    /** @scenario "A scenario card names the scenario and its status, never the payload" */
    it("names the scenario, shows its status, and renders no payload line", () => {
      renderCard(scenarioPayload);

      expect(screen.getByText("Free-plan refund limit")).toBeTruthy();
      expect(screen.getByText("passed")).toBeTruthy();
      expect(
        screen.queryByText(/scenario_0002YwLaq1oHu25iNvSTRDLGq0SAt/),
      ).toBeNull();
      expect(screen.queryByText(/^\{$/)).toBeNull();
      expect(screen.queryByText(/"id"\s*:/)).toBeNull();
    });
  });

  describe("given the same payload arriving as a JSON string", () => {
    it("still renders no line of the serialised document", () => {
      renderCard(JSON.stringify(scenarioPayload));

      expect(screen.queryByText(/"situation"\s*:/)).toBeNull();
      expect(screen.queryByText(/^\{/)).toBeNull();
    });
  });

  describe("given a plain text result naming a verdict", () => {
    it("reads the verdict out of the prose", () => {
      renderCard("The simulation failed on the second turn.");

      expect(screen.getByText("failed")).toBeTruthy();
    });
  });
});
