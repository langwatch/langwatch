/** Measured layout of the glass Drawer in real Chromium: underlap, clearance, edges, fallbacks. */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { Drawer, DrawerGlassProvider } from "../src/components/overlays/drawer.tsx";
import { Input, Stack, Text } from "../src/primitives.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const ROWS = Array.from({ length: 40 }, (_, index) => `Row ${index + 1}`);

function renderDrawer({ glass }: { glass: boolean }) {
  renderWithDesignSystem(
    <DrawerGlassProvider value={glass}>
      <Drawer
        title="Production key"
        subtitle="Rotates every ninety days"
        onClose={() => undefined}
        toolbar={<Text>Filters</Text>}
        footer={{
          summary: <Text>40 rows</Text>,
          primaryAction: { label: "Save", onClick: () => undefined },
        }}
        data-testid="key"
      >
        <Stack gap={3}>
          {ROWS.map((row) => (
            <Input key={row} aria-label={row} placeholder={row} />
          ))}
        </Stack>
      </Drawer>
    </DrawerGlassProvider>,
  );
}

const rect = (element: Element) => element.getBoundingClientRect();
const body = () => screen.getByTestId("key-body");
const header = () => {
  const band = document.querySelector("[data-chrome='header']");
  if (!band) throw new Error("no header band");
  return band;
};
const footer = () => {
  const band = document.querySelector("[data-chrome='footer']");
  if (!band) throw new Error("no footer band");
  return band;
};

beforeEach(async () => {
  await page.viewport(1000, 700);
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-reduced-graphics");
});

describe("a glass drawer in a browser", () => {
  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("lets the body fill the drawer beneath the header band and footer", async () => {
    renderDrawer({ glass: true });
    await waitFor(() => expect(body().style.getPropertyValue("--lw-drawer-top")).not.toBe(""));

    expect(rect(header()).top).toBeCloseTo(rect(body()).top, 0);
    expect(rect(footer()).bottom).toBeCloseTo(rect(body()).bottom, 0);
    expect(rect(header()).height).toBeGreaterThan(40);
    expect(getComputedStyle(body()).overflowY).toBe("auto");
    expect(parseFloat(getComputedStyle(body()).paddingTop)).toBeCloseTo(
      rect(header()).height + 16,
      0,
    );
    expect(parseFloat(getComputedStyle(body()).paddingBottom)).toBeCloseTo(
      rect(footer()).height + 16,
      0,
    );
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("keeps the first and last row reachable, clear of the glass", async () => {
    renderDrawer({ glass: true });
    await waitFor(() => expect(body().style.getPropertyValue("--lw-drawer-top")).not.toBe(""));

    expect(rect(screen.getByLabelText("Row 1")).top).toBeGreaterThanOrEqual(rect(header()).bottom);
    act(() => {
      body().scrollTop = body().scrollHeight;
    });
    await waitFor(() =>
      expect(rect(screen.getByLabelText("Row 40")).bottom).toBeLessThanOrEqual(
        rect(footer()).top + 0.5,
      ),
    );
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("scrolls a focused field clear of the glass", async () => {
    renderDrawer({ glass: true });
    await waitFor(() => expect(body().style.getPropertyValue("--lw-drawer-top")).not.toBe(""));

    act(() => screen.getByLabelText("Row 20").focus());

    await waitFor(() => {
      const field = rect(screen.getByLabelText("Row 20"));
      expect(field.top).toBeGreaterThanOrEqual(rect(header()).bottom - 0.5);
      expect(field.bottom).toBeLessThanOrEqual(rect(footer()).top + 0.5);
    });
  });

  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it("shows the edges only while content waits beyond them", async () => {
    renderDrawer({ glass: true });
    await waitFor(() => expect(footer().getAttribute("data-edge")).toBe("on"));
    expect(header().getAttribute("data-edge")).toBe("off");
    expect(getComputedStyle(header()).borderBottomColor).toBe("rgba(0, 0, 0, 0)");

    fireEvent.scroll(body(), { target: { scrollTop: 300 } });
    await waitFor(() => expect(header().getAttribute("data-edge")).toBe("on"));
    await waitFor(() =>
      expect(getComputedStyle(header()).borderBottomColor).not.toBe("rgba(0, 0, 0, 0)"),
    );

    act(() => {
      body().scrollTop = body().scrollHeight;
    });
    await waitFor(() => expect(footer().getAttribute("data-edge")).toBe("off"));
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("blurs behind the bands, and goes opaque when graphics are reduced", async () => {
    renderDrawer({ glass: true });
    await waitFor(() => expect(body().style.getPropertyValue("--lw-drawer-top")).not.toBe(""));
    expect(getComputedStyle(header()).backdropFilter).toBe("blur(12px)");

    document.documentElement.setAttribute("data-reduced-graphics", "true");

    await waitFor(() => expect(getComputedStyle(header()).backdropFilter).toBe("none"));
    expect(getComputedStyle(footer()).backdropFilter).toBe("none");
  });

  /** @scenario "The translucent header and footer are on by default, approved after the screenshots" */
  it("keeps the solid look's flow layout when the glass is off", async () => {
    renderDrawer({ glass: false });
    const title = await screen.findByText("Production key");

    expect(rect(title).bottom).toBeLessThanOrEqual(rect(body()).top);
    expect(getComputedStyle(body()).paddingTop).toBe("16px");
    expect(document.querySelector("[data-chrome]")).toBeNull();
  });

  /** @scenario "A drawer title is medium weight with no rule under the header" */
  it.each([true, false])(
    "draws a medium-weight title with no rule under it (glass %s)",
    async (glass) => {
      renderDrawer({ glass });
      const title = await screen.findByText("Production key");
      const headerPart = title.closest(".chakra-drawer__header");
      if (!headerPart) throw new Error("no header part");

      expect(getComputedStyle(title).fontWeight).toBe("500");
      expect(getComputedStyle(headerPart).borderBottomWidth).toBe("0px");
    },
  );
});
