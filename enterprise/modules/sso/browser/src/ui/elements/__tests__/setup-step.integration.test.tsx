/**
 * @vitest-environment jsdom
 * One row of the setup timeline. Unbound: the scenarios it serves describe the
 * setup screen this element will hang in, which waits on `ssoSetup.getSetup`
 * (handoff §10).
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { SetupStep, SetupSteps } from "../setup-step.tsx";

function renderStep(
  overrides: Partial<Parameters<typeof SetupStep>[0]> & { number?: number } = {},
) {
  return renderWithSsoHost(
    <SetupSteps>
      <SetupStep
        number={overrides.number ?? 2}
        title={overrides.title ?? "Prove your domain"}
        state={overrides.state}
        note={overrides.note}
        summary={overrides.summary}
        last={overrides.last}
      >
        <p>{overrides.children ?? "The record to publish"}</p>
      </SetupStep>
    </SetupSteps>,
  );
}

afterEach(cleanup);

describe("given a step that is finished", () => {
  it("keeps the answer it arrived at and closes the workspace", () => {
    renderStep({ state: "done", summary: "acme.com" });

    expect(screen.getByTestId("setup-step-2").dataset.stepState).toBe("done");
    expect(screen.getByTestId("step-done").textContent).toContain("Done");
    expect(screen.getByText("acme.com")).toBeTruthy();
  });

  it("reopens when the reader asks what they put in it", async () => {
    renderStep({ state: "done", summary: "acme.com" });
    await userEvent.click(screen.getByText("Prove your domain"));

    expect(screen.queryByText("acme.com")).toBeNull();
  });
});

describe("given the step to do now", () => {
  it("says so, and shows its workspace rather than its summary", () => {
    renderStep({ state: "current", summary: "acme.com" });

    expect(screen.getByTestId("step-current").textContent).toContain("Do this next");
    expect(screen.queryByText("acme.com")).toBeNull();
    expect(screen.getByText("The record to publish")).toBeTruthy();
  });
});

describe("given a step that cannot be done yet", () => {
  it("names what it is waiting for rather than only refusing", () => {
    renderStep({
      state: "blocked",
      note: "Turning it on needs a proved domain. Finish that step above and this opens up.",
    });

    expect(screen.getByTestId("step-blocked").textContent).toContain("Waiting");
    expect(screen.getByTestId("step-blocked-note").textContent).toContain("a proved domain");
  });
});

describe("given a step that is merely later", () => {
  it("is left unremarkable, with nothing to read off it", () => {
    renderStep({ state: "todo" });

    expect(screen.queryByTestId("step-todo")).toBeNull();
    expect(screen.queryByTestId("step-done")).toBeNull();
    expect(screen.getByTestId("setup-step-2").dataset.stepState).toBe("todo");
  });
});
