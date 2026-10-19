// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetupView } from "../setup-view.tsx";
import { statusSchema } from "../telemetry-api.ts";
import { wireStatus } from "./fake-sim.ts";

const refresh = async () => undefined;

describe("SetupView", () => {
  afterEach(() => cleanup());

  /** @scenario The setup shows the target, where the key came from and its project, never the key */
  it("shows the OTLP base, the masked key with its source and the project", () => {
    render(<SetupView status={statusSchema.parse(wireStatus)} refresh={refresh} />);

    expect(screen.getByText(wireStatus.endpoint)).toBeTruthy();
    expect(screen.getByText("sk-lw-…-key (from TELEMETRYSIM_API_KEY)")).toBeTruthy();
    expect(screen.getByText("local-dev-org/local-dev-project")).toBeTruthy();
  });

  it("says every run must name its target when haven gave none", () => {
    render(
      <SetupView
        status={statusSchema.parse({ ...wireStatus, endpoint: undefined })}
        refresh={refresh}
      />,
    );

    expect(screen.getByText("No default target")).toBeTruthy();
  });
});
