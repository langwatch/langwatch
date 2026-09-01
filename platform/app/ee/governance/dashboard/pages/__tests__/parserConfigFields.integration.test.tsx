// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The composer's source-specific fields: the Advanced group that keeps rarely
 * needed options out of the leading path, the switch control, and the (i) that
 * carries every field's explanation.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Spec: specs/governance/pulled-seats.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { SourceType } from "../../components/ingestionSourceCatalog";
import { ParserConfigFields } from "../inventory";

function Harness({ sourceType }: { sourceType: SourceType }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <>
      <ParserConfigFields
        sourceType={sourceType}
        values={values}
        onChange={setValues}
      />
      {/* What the builder would be handed. A control that looks right and
          writes nothing is the failure these tests exist to catch. */}
      <div data-testid="held-values">{JSON.stringify(values)}</div>
    </>
  );
}

const heldValues = (): Record<string, string> =>
  JSON.parse(screen.getByTestId("held-values").textContent ?? "{}");

async function expandAdvanced() {
  const user = userEvent.setup();
  await user.click(screen.getByText("Advanced"));
  return user;
}

const renderFields = (sourceType: SourceType) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Harness sourceType={sourceType} />
    </ChakraProvider>,
  );

describe("given the Genie source-specific fields", () => {
  describe("when the form first renders", () => {
    /** @scenario "Genie setup asks for the service principal first" */
    it("shows workspace URL and the service principal pair, in that order", () => {
      renderFields("databricks_genie");
      const labels = screen
        .getAllByText(
          /Workspace URL|Service principal client ID|Service principal secret/,
        )
        .map((el) => el.textContent);
      expect(labels.slice(0, 3)).toEqual([
        expect.stringContaining("Workspace URL"),
        expect.stringContaining("Service principal client ID"),
        expect.stringContaining("Service principal secret"),
      ]);
    });

    /** @scenario "Genie setup asks for the service principal first" */
    it("keeps the token, space IDs, and warehouse ID hidden until Advanced expands", async () => {
      renderFields("databricks_genie");
      expect(screen.queryByText("Workspace token")).toBeNull();
      expect(screen.queryByText(/Genie space IDs/)).toBeNull();
      expect(screen.queryByText(/SQL warehouse ID/)).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByText("Advanced"));
      await waitFor(() => {
        expect(screen.getByText("Workspace token")).toBeTruthy();
      });
      expect(screen.getByText(/Genie space IDs/)).toBeTruthy();
      expect(screen.getByText(/SQL warehouse ID/)).toBeTruthy();
    });
  });

  describe("when a source type declares no Advanced fields", () => {
    it("renders no Advanced group at all", () => {
      renderFields("s3_custom");
      expect(screen.queryByText("Advanced")).toBeNull();
    });
  });
});

describe("given a source whose fields carry an explanation", () => {
  describe("when the form renders", () => {
    /** @scenario "Genie setup asks for the service principal first" */
    it("puts the explanation behind an (i) rather than under the input", () => {
      renderFields("copilot_studio_dataverse");

      // A paragraph under every input is what turned this form into a wall of
      // grey text; the label says what the setting is and the (i) carries the
      // why. See dev/docs/best_practices/copywriting.md.
      const explanation = screen.getByText(/From Power Platform admin centre/);
      expect(explanation.closest('[data-scope="popover"]')).not.toBeNull();
      expect(
        screen.getByTestId("parser-field-info-environmentUrl"),
      ).toBeTruthy();
    });

    /** @scenario "Genie setup asks for the service principal first" */
    it("shows the explanation once the (i) is opened", async () => {
      renderFields("copilot_studio_dataverse");

      const user = userEvent.setup();
      await user.click(screen.getByTestId("parser-field-info-environmentUrl"));

      await waitFor(() => {
        expect(
          screen.getByText(/From Power Platform admin centre/),
        ).toBeTruthy();
      });
    });

    /** @scenario "Genie setup asks for the service principal first" */
    it("gives a field with nothing to explain no (i) at all", () => {
      renderFields("copilot_studio_dataverse");

      expect(
        screen.queryByTestId("parser-field-info-credentialsTenantId"),
      ).toBeNull();
    });
  });
});

describe("given the Copilot Studio licence switch", () => {
  describe("when Advanced is expanded", () => {
    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("shows the switch already on, holding nothing", async () => {
      renderFields("copilot_studio_dataverse");
      await expandAdvanced();

      const toggle = (await screen.findByTestId(
        "parser-switch-readSeats",
      )) as HTMLInputElement;

      // On while the form holds no value at all: the default lives on the
      // field definition, which is the same declaration the builder reads, so
      // an untouched form cannot show one answer and save another.
      expect(toggle.checked).toBe(true);
      expect(heldValues().readSeats).toBeUndefined();
    });

    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("writes an explicit off when the admin turns it down", async () => {
      renderFields("copilot_studio_dataverse");
      const user = await expandAdvanced();

      const toggle = await screen.findByTestId("parser-switch-readSeats");
      await user.click(toggle);

      // "false", never blank: blank means the default, which is on.
      await waitFor(() => {
        expect(heldValues().readSeats).toBe("false");
      });
      expect((toggle as HTMLInputElement).checked).toBe(false);
    });

    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("names itself for anyone not looking at the label", async () => {
      renderFields("copilot_studio_dataverse");
      await expandAdvanced();

      const toggle = await screen.findByTestId("parser-switch-readSeats");

      // The field label is a heading beside the control, not a <label> bound
      // to it, so the accessible name has to come from the control itself.
      expect(toggle.getAttribute("aria-label")).toBe(
        "Also record licence counts",
      );
    });
  });
});
