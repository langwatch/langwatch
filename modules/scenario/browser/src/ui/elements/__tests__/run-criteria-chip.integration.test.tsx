/**
 * @vitest-environment jsdom
 * @see specs/scenarios/judge-criterion-verdicts.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { RunCriteriaChip } from "../run-criteria-chip.tsx";

afterEach(cleanup);

describe("RunCriteriaChip", () => {
  describe("when a run has a criterion the test could not check", () => {
    /** @scenario "The criteria chip counts a criterion the test could not check apart" */
    it("lists it under Could not check, not under Unmet", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <RunCriteriaChip
            metCriteria={["stays polite"]}
            unmetCriteria={["names the refund window", "opens a ticket"]}
            inconclusiveCriteria={["opens a ticket"]}
          />
        </ChakraProvider>,
      );

      await userEvent.hover(screen.getByText("1/3"));

      const unchecked = await screen.findByText("Could not check (1)");
      const unmet = screen.getByText("Unmet (1)");
      expect(unchecked.parentElement).toHaveTextContent("opens a ticket");
      expect(unmet.parentElement).toHaveTextContent("names the refund window");
      expect(unmet.parentElement).not.toHaveTextContent("opens a ticket");
    });
  });
});
