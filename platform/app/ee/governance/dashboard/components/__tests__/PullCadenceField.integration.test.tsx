// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Cadence section of the source composer: a friendly frequency picker
 * for pull-mode sources, with cron editing behind an explicit toggle.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * Controlled like the drawer uses it: `value` is the composer's
 * pullSchedule ("" = recommended default, resolved at create), edits come
 * back through `onChange` as a cron string.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SourceType } from "../ingestionSourceCatalog";
import { PullCadenceField } from "../PullCadenceField";

function Harness({
  sourceType,
  initialValue,
  onChangeSpy,
}: {
  sourceType: SourceType;
  initialValue: string;
  onChangeSpy?: (next: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <PullCadenceField
      sourceType={sourceType}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
    />
  );
}

const renderField = (props: Parameters<typeof Harness>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Harness {...props} />
    </ChakraProvider>,
  );

describe("given the Cadence section of the composer", () => {
  describe("when a pull-mode source is being composed", () => {
    /** @scenario "The Cadence section opens on a friendly picker, prefilled" */
    it("shows a Cadence title and a frequency picker, not a cron text box", () => {
      renderField({ sourceType: "databricks_genie", initialValue: "" });
      expect(screen.getByText("Cadence")).toBeTruthy();
      const frequency = screen.getByLabelText<HTMLSelectElement>("Frequency");
      expect(frequency.value).toBe("m15");
      expect(screen.queryByLabelText("Cron expression")).toBeNull();
    });

    /** @scenario "The Cadence section opens on a friendly picker, prefilled" */
    it("prefills from the source's recommended schedule", () => {
      renderField({ sourceType: "anthropic_admin", initialValue: "" });
      const frequency = screen.getByLabelText<HTMLSelectElement>("Frequency");
      expect(frequency.value).toBe("hourly");
    });

    /** @scenario "The Cadence section opens on a friendly picker, prefilled" */
    it("does not restate the picked schedule underneath the picker", () => {
      renderField({ sourceType: "anthropic_admin", initialValue: "" });

      // The select already reads "Every hour". A sentence under it saying the
      // same thing is a second copy of the answer the admin is looking at,
      // and a pair of them per field is what made this drawer grey text.
      expect(screen.queryByTestId("cadence-summary")).toBeNull();
      expect(
        screen.queryByText(/Leave as-is to use the recommended schedule/),
      ).toBeNull();
    });

    /** @scenario "The Cadence section opens on a friendly picker, prefilled" */
    it("puts the explanation behind an (i) beside the Cadence heading", async () => {
      renderField({ sourceType: "anthropic_admin", initialValue: "" });

      const user = userEvent.setup();
      await user.click(screen.getByTestId("cadence-field-info"));

      await waitFor(() => {
        expect(
          screen.getByText(/How often we check this source for new activity/),
        ).toBeTruthy();
      });
    });

    it("renders nothing for a source that has no pull schedule", () => {
      renderField({ sourceType: "otel_generic", initialValue: "" });
      expect(screen.queryByText("Cadence")).toBeNull();
    });
  });

  describe("when the admin picks a different cadence", () => {
    /** @scenario "Picking a cadence saves exactly that schedule" */
    it("emits the matching cron, with the select itself as the only feedback", async () => {
      const onChangeSpy = vi.fn();
      renderField({
        sourceType: "databricks_genie",
        initialValue: "",
        onChangeSpy,
      });
      const user = userEvent.setup();
      const frequency = screen.getByLabelText<HTMLSelectElement>("Frequency");
      await user.selectOptions(frequency, "hourly");
      expect(onChangeSpy).toHaveBeenLastCalledWith("0 * * * *");
      expect(frequency.value).toBe("hourly");
      expect(screen.queryByTestId("cadence-summary")).toBeNull();
    });

    /** @scenario "Leaving the cadence untouched keeps the recommended schedule" */
    it("emits nothing while the picker is untouched", () => {
      const onChangeSpy = vi.fn();
      renderField({
        sourceType: "databricks_genie",
        initialValue: "",
        onChangeSpy,
      });
      expect(onChangeSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the admin turns on cron editing", () => {
    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("shows the effective cron and keeps a hand-typed one as typed", async () => {
      renderField({ sourceType: "databricks_genie", initialValue: "" });
      const user = userEvent.setup();
      await user.click(screen.getByLabelText("Edit as a cron expression"));
      const input = screen.getByLabelText<HTMLInputElement>("Cron expression");
      expect(input.value).toBe("*/15 * * * *");
      await user.clear(input);
      await user.type(input, "0 9 1 * *");
      expect(input.value).toBe("0 9 1 * *");
    });

    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("refuses a cron that can never run with a plain message", async () => {
      renderField({ sourceType: "databricks_genie", initialValue: "" });
      const user = userEvent.setup();
      await user.click(screen.getByLabelText("Edit as a cron expression"));
      const input = screen.getByLabelText<HTMLInputElement>("Cron expression");
      await user.clear(input);
      await user.type(input, "99 * * * *");
      expect(
        screen.getByText(/five fields|can't run|cannot run/i),
      ).toBeTruthy();
      // A cron that parses but never fires — February 30th — gets its own
      // message, matching the server's next-run refusal.
      await user.clear(input);
      await user.type(input, "0 9 30 2 *");
      expect(screen.getByText(/never comes around/i)).toBeTruthy();
    });
  });

  describe("when cron editing is on", () => {
    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("keeps the plain-words reading of the typed cron", async () => {
      renderField({ sourceType: "databricks_genie", initialValue: "" });
      const user = userEvent.setup();
      await user.click(screen.getByLabelText("Edit as a cron expression"));

      const input = screen.getByLabelText<HTMLInputElement>("Cron expression");
      await user.clear(input);
      await user.type(input, "0 * * * *");

      // Unlike the select, a cron box shows five fields and no meaning, so
      // this sentence is the only thing that says what the typed value does.
      // That is why it survives here and not in the picker.
      await waitFor(() => {
        expect(screen.getByTestId("cadence-summary").textContent).toContain(
          "every hour, on the hour",
        );
      });
    });
  });

  describe("when a stored cron is outside the picker's shapes", () => {
    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("opens in cron mode with the value intact", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "0 9 1 * *",
      });
      const input = screen.getByLabelText<HTMLInputElement>("Cron expression");
      expect(input.value).toBe("0 9 1 * *");
    });
  });
});
