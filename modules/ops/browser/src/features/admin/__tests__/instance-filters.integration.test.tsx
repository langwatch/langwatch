/** @vitest-environment jsdom */
/**
 * The filters above the self-hosted installs list: each pick emits the filter object the list
 * query reads, and "any" clears its filter back to absent.
 * Spec: specs/self-hosting/connected-services/instance-registry.feature
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { SelfHostedInstanceFilters } from "../model/self-hosted-instance.ts";
import { InstanceFilters } from "../ui/elements/instance-filters.tsx";

function Harness({ emitted }: { emitted: SelfHostedInstanceFilters[] }) {
  const [value, setValue] = useState<SelfHostedInstanceFilters>({ sort: "last_report" });
  return (
    <InstanceFilters
      value={value}
      onChange={(next) => {
        emitted.push(next);
        setValue(next);
      }}
    />
  );
}

async function pick({ label, option }: { label: string; option: string }) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByRole("combobox", { name: label }));
  const options = await screen.findAllByRole("option", { name: option, hidden: true });
  await user.click(options.find((each) => each.tagName === "DIV") ?? options[0]!);
}

describe("<InstanceFilters/>", () => {
  describe("given the operator picks a sort, a license, an activity and a signal", () => {
    /** @scenario "An operator narrows the list by license, activity or raised signal" */
    it("emits each pick, then clears each filter again when set back to any", async () => {
      const emitted: SelfHostedInstanceFilters[] = [];
      renderWithOpsHost(<Harness emitted={emitted} />);

      await pick({ label: "Sort by", option: "Newest install" });
      await pick({ label: "License", option: "Open source" });
      await pick({ label: "Activity", option: "quiet" });
      await pick({ label: "Signal", option: "Sustained ingestion" });

      expect(emitted.at(-1)).toEqual({
        sort: "newest",
        license: "open_source",
        activity: "quiet",
        signal: "sustained_ingestion",
      });

      await pick({ label: "License", option: "Any license" });
      await pick({ label: "Activity", option: "Any activity" });
      await pick({ label: "Signal", option: "Any signal" });

      expect(emitted.at(-1)).toEqual({
        sort: "newest",
        license: undefined,
        activity: undefined,
        signal: undefined,
      });
    });
  });
});
