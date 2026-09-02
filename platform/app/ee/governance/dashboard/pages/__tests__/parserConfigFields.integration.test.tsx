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
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";
import type { SourceType } from "../../components/ingestionSourceCatalog";
import { ParserConfigFields } from "../inventory";

function Harness({
  sourceType,
  advancedExtras,
}: {
  sourceType: SourceType;
  advancedExtras?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <>
      <ParserConfigFields
        sourceType={sourceType}
        values={values}
        onChange={setValues}
        advancedExtras={advancedExtras}
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

const renderFields = (sourceType: SourceType, advancedExtras?: ReactNode) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Harness sourceType={sourceType} advancedExtras={advancedExtras} />
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

/**
 * Settings that are not parser fields but belong in the same collapsed group:
 * today the pull cadence. They arrive as `advancedExtras` rather than as a
 * second collapsible, because two "Advanced" headings in one drawer would
 * leave an admin guessing which one holds the thing they came for.
 */
describe("given settings that belong in Advanced but are not parser fields", () => {
  const extras = <div data-testid="advanced-extra">extra setting</div>;

  describe("when the group is collapsed", () => {
    it("keeps them out of sight until Advanced expands", async () => {
      renderFields("databricks_genie", extras);
      expect(screen.queryByTestId("advanced-extra")).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByText("Advanced"));

      await waitFor(() => {
        expect(screen.getByTestId("advanced-extra")).toBeTruthy();
      });
    });
  });

  describe("when the source type declares no advanced parser fields of its own", () => {
    /**
     * Six of the eight pull source types declare no advanced parser field, so
     * a group that only appears for the other two would swallow their cadence
     * entirely — the setting would be reachable on Genie and Dataverse and
     * nowhere else.
     */
    it("still offers the group, so the extras are reachable", async () => {
      renderFields("copilot_studio", extras);

      const user = userEvent.setup();
      await user.click(screen.getByText("Advanced"));

      await waitFor(() => {
        expect(screen.getByTestId("advanced-extra")).toBeTruthy();
      });
    });
  });

  describe("when the group is closed again", () => {
    /**
     * The group unmounts what it holds, so anything inside it must keep its
     * value in the parent's state rather than its own. A cadence that reset
     * to the recommended schedule every time the group was closed would
     * silently discard a choice the admin had already made.
     */
    it("gives back what was there, because the value never lived inside it", async () => {
      function Owner() {
        const [held, setHeld] = useState("");
        return (
          <ChakraProvider value={defaultSystem}>
            <Harness
              sourceType="copilot_studio"
              advancedExtras={
                <input
                  aria-label="parent-held setting"
                  value={held}
                  onChange={(e) => setHeld(e.target.value)}
                />
              }
            />
            <div data-testid="parent-held">{held}</div>
          </ChakraProvider>
        );
      }
      render(<Owner />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Advanced"));
      await user.type(
        await screen.findByLabelText("parent-held setting"),
        "0 * * * *",
      );

      await user.click(screen.getByText("Advanced"));
      await waitFor(() => {
        expect(screen.queryByLabelText("parent-held setting")).toBeNull();
      });
      await user.click(screen.getByText("Advanced"));

      const reopened = await screen.findByLabelText<HTMLInputElement>(
        "parent-held setting",
      );
      expect(reopened.value).toBe("0 * * * *");
      expect(screen.getByTestId("parent-held").textContent).toBe("0 * * * *");
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

describe("given the Copilot Studio create form", () => {
  describe("when the form first renders", () => {
    /** @scenario "Copilot Studio setup reads as three purposes, in the order admins care" */
    it("stands in three labelled groups, connection then cost then conversation", () => {
      renderFields("copilot_studio_dataverse");

      const headings = screen
        .getAllByText(/^(Connection|Cost|Conversation access)$/)
        .map((el) => el.textContent);
      expect(headings).toEqual(["Connection", "Cost", "Conversation access"]);
    });

    /** @scenario "A new source starts with one app registration for everything" */
    it("starts with the one-app switch on and no billing fields in sight", () => {
      renderFields("copilot_studio_dataverse");

      const oneApp = screen.getByTestId(
        "parser-switch-azureBillingUsesSameApp",
      ) as HTMLInputElement;
      expect(oneApp.checked).toBe(true);
      expect(
        screen.queryByText(/Billing app registration client ID/),
      ).toBeNull();
      expect(
        screen.queryByText(/Billing app registration client secret/),
      ).toBeNull();
    });
  });

  describe("when the admin turns the one-app switch off", () => {
    /** @scenario "Turning the switch off reveals the billing credential fields" */
    it("reveals the billing credential fields", async () => {
      renderFields("copilot_studio_dataverse");
      const user = userEvent.setup();

      await user.click(
        screen.getByTestId("parser-switch-azureBillingUsesSameApp"),
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Billing app registration client ID/),
        ).toBeTruthy();
      });
      expect(
        screen.getByText(/Billing app registration client secret/),
      ).toBeTruthy();
    });
  });
});
