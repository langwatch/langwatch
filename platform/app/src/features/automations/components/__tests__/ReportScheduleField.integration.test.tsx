/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportScheduleField } from "../ReportScheduleField";

// The viewer's locale is non-deterministic across machines/CI, so pin the
// browser timezone the "default to locale" behaviour reads.
vi.mock("../../logic/reportSchedule", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../logic/reportSchedule")>();
  return { ...actual, defaultTimezone: () => "Europe/Amsterdam" };
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** Controlled host so the field behaves as it does in the drawer: props in,
 *  edits back out through `onChange`, which the spy observes. */
function Harness({
  initialCron,
  initialTimezone,
  isEdit,
  onChangeSpy,
}: {
  initialCron: string;
  initialTimezone: string;
  isEdit: boolean;
  onChangeSpy?: (next: { cron: string; timezone: string }) => void;
}) {
  const [value, setValue] = useState({
    cron: initialCron,
    timezone: initialTimezone,
  });
  return (
    <ReportScheduleField
      cron={value.cron}
      timezone={value.timezone}
      isEdit={isEdit}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
    />
  );
}

const renderField = (props: Parameters<typeof Harness>[0]) =>
  render(<Harness {...props} />, { wrapper: Wrapper });

function selectContainingOption(optionName: RegExp): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const match = selects.find((select) =>
    within(select)
      .queryAllByRole("option")
      .some((option) => optionName.test(option.textContent ?? "")),
  );
  if (!match) throw new Error(`No select with option ${String(optionName)}`);
  return match;
}

describe("ReportScheduleField", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the default weekly schedule", () => {
    it("renders the friendly picker and hides the raw cron field", () => {
      renderField({
        initialCron: "0 9 * * 1",
        initialTimezone: "UTC",
        isEdit: true,
      });

      expect(selectContainingOption(/Weekly/i)).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText("0 9 * * 1"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/Sends every Monday at 09:00/i),
      ).toBeInTheDocument();
    });
  });

  describe("when Advanced is toggled on", () => {
    it("reveals the raw cron input", async () => {
      const user = userEvent.setup();
      renderField({
        initialCron: "0 9 * * 1",
        initialTimezone: "UTC",
        isEdit: true,
      });

      expect(screen.queryByDisplayValue("0 9 * * 1")).not.toBeInTheDocument();

      await user.click(screen.getByLabelText(/Edit as a cron expression/i));

      expect(screen.getByDisplayValue("0 9 * * 1")).toBeInTheDocument();
    });
  });

  describe("given a new report with the stale UTC default", () => {
    it("adopts the viewer's locale timezone and emits it", async () => {
      const onChangeSpy = vi.fn();
      renderField({
        initialCron: "0 9 * * 1",
        initialTimezone: "UTC",
        isEdit: false,
        onChangeSpy,
      });

      await waitFor(() =>
        expect(onChangeSpy).toHaveBeenCalledWith({
          cron: "0 9 * * 1",
          timezone: "Europe/Amsterdam",
        }),
      );
    });
  });

  describe("given an existing report being edited", () => {
    it("never clobbers the stored timezone", async () => {
      const onChangeSpy = vi.fn();
      renderField({
        initialCron: "0 9 * * 1",
        initialTimezone: "UTC",
        isEdit: true,
        onChangeSpy,
      });

      // Give any mount effect a tick to (not) fire.
      await new Promise((r) => setTimeout(r, 0));
      expect(onChangeSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the frequency changes to weekly and a day is picked", () => {
    it("emits the matching weekly cron", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderField({
        initialCron: "0 9 * * *", // start daily
        initialTimezone: "UTC",
        isEdit: true,
        onChangeSpy,
      });

      await user.selectOptions(selectContainingOption(/Weekly/i), "Weekly");
      await user.click(screen.getByText("Wed"));

      expect(onChangeSpy).toHaveBeenLastCalledWith({
        cron: "0 9 * * 3",
        timezone: "UTC",
      });
    });
  });

  describe("given a non-standard cron loaded from an old report", () => {
    it("opens Advanced so the value is preserved, not overwritten", () => {
      renderField({
        initialCron: "*/5 9 * * 1-5",
        initialTimezone: "UTC",
        isEdit: true,
      });

      expect(screen.getByDisplayValue("*/5 9 * * 1-5")).toBeInTheDocument();
      expect(() => selectContainingOption(/Weekly/i)).toThrow();
    });
  });
});
