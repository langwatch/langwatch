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
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceType } from "../../src/ingestion-source-catalog";
import { PullCadenceField } from "../../src/components/pull-cadence-field";

afterEach(cleanup);

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
    it("prefills from the source's recommended schedule and says so in plain words", () => {
      renderField({ sourceType: "anthropic_admin", initialValue: "" });
      const frequency = screen.getByLabelText<HTMLSelectElement>("Frequency");
      expect(frequency.value).toBe("hourly");
      expect(
        screen.getByText("Checks for new activity every hour, on the hour"),
      ).toBeTruthy();
    });

    it("renders nothing for a source that has no pull schedule", () => {
      renderField({ sourceType: "otel_generic", initialValue: "" });
      expect(screen.queryByText("Cadence")).toBeNull();
    });
  });

  describe("when the admin picks a different cadence", () => {
    /** @scenario "Picking a cadence saves exactly that schedule" */
    it("emits the matching cron and updates the summary sentence", async () => {
      const onChangeSpy = vi.fn();
      renderField({
        sourceType: "databricks_genie",
        initialValue: "",
        onChangeSpy,
      });
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Frequency"), "hourly");
      expect(onChangeSpy).toHaveBeenLastCalledWith("0 * * * *");
      expect(
        screen.getByText("Checks for new activity every hour, on the hour"),
      ).toBeTruthy();
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
      expect(screen.getByText(/five fields|can't run|cannot run/i)).toBeTruthy();
      // A cron that parses but never fires — February 30th — gets its own
      // message, matching the server's next-run refusal.
      await user.clear(input);
      await user.type(input, "0 9 30 2 *");
      expect(screen.getByText(/never comes around/i)).toBeTruthy();
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
