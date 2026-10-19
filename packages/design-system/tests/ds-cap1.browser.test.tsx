/**
 * Measured layout, focus and default parity for the DS-cap1 capabilities in real Chromium: the
 * frame-fill card, the linked card, the drawer icon and the 16px tab inset.
 * @see packages/design-system/specs/card-shapes.feature
 * @see packages/design-system/specs/overlay-shapes.feature
 * @see packages/design-system/specs/content-tabs.feature
 */
import { Box, Card as ChakraCard, HStack, Text, VStack } from "@chakra-ui/react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Card } from "../src/components/layout/card.tsx";
import { ContentTabs } from "../src/components/layout/content-tabs.tsx";
import { Dialog } from "../src/components/overlays/dialog.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const MODES = ["light", "dark"] as const;

function setMode({ mode }: { mode: (typeof MODES)[number] }) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}

beforeEach(async () => {
  await page.viewport(1000, 700);
});

afterEach(() => {
  cleanup();
  setMode({ mode: "light" });
});

const rect = (element: Element) => element.getBoundingClientRect();

/**
 * The card as it was drawn at ab33d76a36, before the optional capabilities: the baseline the
 * absent-capability cards are measured against.
 */
const LEGACY_OVERRIDES = {
  frame: { background: "transparent", boxShadow: "none", backdropFilter: "none" },
  showcase: { borderRadius: "showcase", boxShadow: "showcase" },
} as const;

function LegacyCard({
  variant,
  title,
  testId,
}: {
  variant: "panel" | "nested" | "frame" | "showcase";
  title: string;
  testId: string;
}) {
  const recipe = variant === "nested" ? "subtle" : "outline";
  const overrides = variant === "frame" || variant === "showcase" ? LEGACY_OVERRIDES[variant] : {};
  return (
    <ChakraCard.Root variant={recipe} width="full" {...overrides} data-testid={testId}>
      <ChakraCard.Body padding={0} gap={0}>
        <Box paddingX={4} paddingTop={4} paddingBottom={2}>
          <Text as="h2" textStyle="cardTitle" minWidth={0}>
            {title}
          </Text>
        </Box>
        <Box paddingX={4} paddingTop={0} paddingBottom={4} flex={1} minWidth={0}>
          <Text textStyle="sm">Body</Text>
        </Box>
      </ChakraCard.Body>
    </ChakraCard.Root>
  );
}

const PARITY_PROPERTIES = [
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderTopLeftRadius",
  "backgroundColor",
  "boxShadow",
  "backdropFilter",
  "overflow",
  "position",
  "display",
  "flexDirection",
  "transitionProperty",
  "transitionDuration",
  "cursor",
] as const;

function styleOf({ element }: { element: Element }) {
  const style = getComputedStyle(element);
  return Object.fromEntries(PARITY_PROPERTIES.map((name) => [name, style[name]]));
}

describe("existing cards with no optional capability", () => {
  for (const mode of MODES) {
    /** @scenario "Existing cards keep their appearance when the optional capabilities are absent" */
    it(`draw as the card at ab33d76a36 did, in ${mode}`, async () => {
      setMode({ mode });
      const variants = ["panel", "nested", "frame", "showcase"] as const;
      renderWithDesignSystem(
        <VStack align="stretch" width="360px" gap={3}>
          {variants.map((variant) => (
            <Box key={variant}>
              <Card variant={variant} title={variant} data-testid={`new-${variant}`}>
                <Text textStyle="sm">Body</Text>
              </Card>
              <LegacyCard variant={variant} title={variant} testId={`old-${variant}`} />
            </Box>
          ))}
        </VStack>,
      );

      for (const variant of variants) {
        const fresh = screen.getByTestId(`new-${variant}`);
        const old = screen.getByTestId(`old-${variant}`);
        expect(styleOf({ element: fresh }), `${variant} root`).toEqual(styleOf({ element: old }));
        expect(rect(fresh).height, `${variant} height`).toBeCloseTo(rect(old).height, 0);
        expect(rect(fresh).width, `${variant} width`).toBeCloseTo(rect(old).width, 0);
        const body = (card: Element) => within(card as HTMLElement).getByText("Body").parentElement;
        const freshBody = body(fresh);
        const oldBody = body(old);
        if (!freshBody || !oldBody) throw new Error("no body");
        expect(getComputedStyle(freshBody).paddingLeft).toBe(getComputedStyle(oldBody).paddingLeft);
        expect(rect(freshBody).top - rect(fresh).top).toBeCloseTo(
          rect(oldBody).top - rect(old).top,
          0,
        );
      }
    });
  }
});

function Neighbours({ height, fill }: { height: number; fill: boolean }) {
  const editor = (
    <Box flex={1} minHeight={0} overflowY="auto" data-testid="editor">
      {Array.from({ length: 60 }, (_, line) => (
        <Text key={line} textStyle="sm" fontFamily="mono" paddingX={3}>
          {`select ${line} from traces;`}
        </Text>
      ))}
    </Box>
  );
  return (
    <VStack
      align="stretch"
      gap={3}
      width="300px"
      style={{ height }}
      data-testid={fill ? "parent-fill" : "parent-box"}
    >
      <Text textStyle="sm" flexShrink={0} data-testid="above">
        Above
      </Text>
      {fill ? (
        <Card variant="frame-fill" data-testid="frame-fill">
          {editor}
        </Card>
      ) : (
        <Box
          flex={1}
          minHeight={0}
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          overflow="hidden"
          display="flex"
          flexDirection="column"
          data-testid="frame-box"
        >
          {editor}
        </Box>
      )}
      <Text textStyle="sm" flexShrink={0} data-testid="below">
        Below
      </Text>
    </VStack>
  );
}

describe("a frame-fill card", () => {
  for (const height of [200, 320]) {
    /** @scenario "An editor frame fills its bounded parent without a second scroller" */
    it(`fills a ${height}px parent between its neighbours and only the editor scrolls`, async () => {
      renderWithDesignSystem(<Neighbours height={height} fill />);

      const parent = screen.getByTestId("parent-fill");
      const card = screen.getByTestId("frame-fill");
      const editor = screen.getByTestId("editor");
      const above = screen.getByTestId("above");
      const below = screen.getByTestId("below");

      await waitFor(() => expect(rect(card).height).toBeGreaterThan(60));
      expect(rect(parent).height).toBeCloseTo(height, 0);
      expect(rect(card).top).toBeGreaterThanOrEqual(rect(above).bottom - 0.5);
      expect(rect(card).bottom).toBeLessThanOrEqual(rect(below).top + 0.5);
      expect(rect(below).bottom).toBeLessThanOrEqual(rect(parent).bottom + 0.5);
      expect(rect(below).top - rect(card).bottom).toBeCloseTo(12, 0);
      expect(rect(card).width).toBeCloseTo(rect(parent).width, 0);

      expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight + 1);
      expect(editor.scrollHeight).toBeGreaterThan(editor.clientHeight + 20);
      editor.scrollTop = 120;
      expect(editor.scrollTop).toBeGreaterThan(0);
      expect(card.scrollTop).toBe(0);
      expect(parent.scrollTop).toBe(0);
    });
  }

  /** @scenario "An editor frame fills its bounded parent without a second scroller" */
  it("measures as the bare bordered box it replaces: size, border, radius and ground", async () => {
    renderWithDesignSystem(
      <HStack align="flex-start" gap={4}>
        <Neighbours height={260} fill />
        <Neighbours height={260} fill={false} />
      </HStack>,
    );
    const card = screen.getByTestId("frame-fill");
    const box = screen.getByTestId("frame-box");

    await waitFor(() => expect(rect(box).height).toBeGreaterThan(60));
    expect(rect(card).height).toBeCloseTo(rect(box).height, 0);
    expect(rect(card).width).toBeCloseTo(rect(box).width, 0);
    for (const name of [
      "borderTopWidth",
      "borderTopStyle",
      "borderTopColor",
      "borderTopLeftRadius",
      "overflow",
    ] as const) {
      expect(getComputedStyle(card)[name], name).toBe(getComputedStyle(box)[name]);
    }
    const ground = getComputedStyle(card);
    expect(ground.boxShadow).toBe("none");
    expect(ground.backdropFilter).toBe("none");
    expect(ground.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("a linked card", () => {
  function Linked({ clicks }: { clicks: Event[] }) {
    return (
      <form>
        <VStack align="stretch" width="320px" gap={3}>
          <Card
            padding="none"
            opener={
              <a
                href="#cap1-target"
                aria-label="Open the traffic dashboard"
                onClick={(event) => {
                  clicks.push(event.nativeEvent);
                  event.preventDefault();
                }}
              />
            }
            data-testid="linked"
          >
            <Box paddingX={4} paddingY={3}>
              <Text textStyle="sm">Traffic</Text>
            </Box>
          </Card>
          <Card
            padding="none"
            title="Create a dashboard"
            opener={createElement("button")}
            data-testid="action-card"
          />
          <button type="button">After</button>
        </VStack>
      </form>
    );
  }

  /** @scenario "A linked card has one native keyboard target and keeps browser navigation" */
  it("is one tab stop, activates once on Enter and leaves a modified click to the browser", async () => {
    const clicks: Event[] = [];
    renderWithDesignSystem(<Linked clicks={clicks} />);
    const link = screen.getByRole("link", { name: "Open the traffic dashboard" });

    expect(link.getAttribute("href")).toBe("#cap1-target");
    await userEvent.tab();
    expect(document.activeElement).toBe(link);
    await userEvent.keyboard("{Enter}");
    expect(clicks).toHaveLength(1);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create a dashboard" }));

    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(modified);
    expect(clicks).toHaveLength(2);
    expect((clicks[1] as MouseEvent).ctrlKey).toBe(true);
  });

  /** @scenario "A linked card has one native keyboard target and keeps browser navigation" */
  it("covers the whole card with its focus ring inside it, and a button opener never submits", async () => {
    let submitted = 0;
    renderWithDesignSystem(
      <div
        onSubmitCapture={(event) => {
          submitted += 1;
          event.preventDefault();
        }}
      >
        <Linked clicks={[]} />
      </div>,
    );
    const card = screen.getByTestId("linked");
    const link = screen.getByRole("link");

    await userEvent.tab();
    const ring = getComputedStyle(link);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    expect(ring.outlineOffset).toBe("-2px");
    const border = parseFloat(getComputedStyle(card).borderTopWidth);
    expect(rect(link).width).toBeCloseTo(rect(card).width - 2 * border, 0);
    expect(rect(link).height).toBeCloseTo(rect(card).height - 2 * border, 0);
    expect(rect(link).left).toBeCloseTo(rect(card).left + border, 0);

    await userEvent.click(screen.getByRole("button", { name: "Create a dashboard" }));
    expect(submitted).toBe(0);
  });

  /** @scenario "A linked card has one native keyboard target and keeps browser navigation" */
  it("paints a hover border and shadow only when it has an opener", async () => {
    renderWithDesignSystem(
      <VStack align="stretch" width="320px" gap={3}>
        <Card padding="none" opener={<a href="#x" aria-label="Open" />} data-testid="linked">
          <Box paddingX={4} paddingY={3}>
            <Text textStyle="sm">Traffic</Text>
          </Box>
        </Card>
        <Card padding="none" data-testid="plain">
          <Box paddingX={4} paddingY={3}>
            <Text textStyle="sm">Traffic</Text>
          </Box>
        </Card>
      </VStack>,
    );
    const linked = screen.getByTestId("linked");
    const plain = screen.getByTestId("plain");
    const before = { linked: getComputedStyle(linked), plain: getComputedStyle(plain) };
    const rest = { border: before.linked.borderTopColor, shadow: before.linked.boxShadow };
    const plainRest = { border: before.plain.borderTopColor, shadow: before.plain.boxShadow };

    await userEvent.hover(screen.getByRole("link", { name: "Open" }));
    await waitFor(() => expect(getComputedStyle(linked).borderTopColor).not.toBe(rest.border));
    expect(getComputedStyle(linked).boxShadow).not.toBe(rest.shadow);
    expect(getComputedStyle(plain).borderTopColor).toBe(plainRest.border);
    expect(getComputedStyle(plain).boxShadow).toBe(plainRest.shadow);
    expect(getComputedStyle(linked).transitionProperty).toBe("border-color, box-shadow");
    expect(getComputedStyle(plain).cursor).not.toBe("pointer");
  });
});

describe("a drawer with a 24px icon", () => {
  const LONG = "A source type with a name long enough to wrap onto a second line of the header";

  for (const width of [1000, 320]) {
    /** @scenario "A drawer title keeps its 24px source icon visible" */
    it(`keeps the glyph 24px and unclipped beside a wrapping title at ${width}px`, async () => {
      await page.viewport(width, 700);
      renderWithDesignSystem(
        <Drawer
          onClose={() => undefined}
          title={LONG}
          subtitle="Connected 4 minutes ago"
          icon={<svg width="24" height="24" data-testid="glyph" />}
          size="sm"
        />,
      );
      const drawer = await screen.findByRole("dialog", { name: LONG });
      const glyph = within(drawer).getByTestId("glyph");
      const heading = within(drawer).getByRole("heading", { name: LONG });
      const slot = glyph.parentElement;
      if (!slot) throw new Error("no icon slot");

      await waitFor(() => expect(rect(glyph).width).toBeGreaterThan(0));
      expect(rect(glyph).width).toBeCloseTo(24, 0);
      expect(rect(glyph).height).toBeCloseTo(24, 0);
      expect(rect(slot).width).toBeGreaterThanOrEqual(24);
      expect(slot.scrollWidth).toBeLessThanOrEqual(slot.clientWidth);
      expect(getComputedStyle(slot).overflow).toBe("visible");
      expect(rect(heading).left).toBeGreaterThanOrEqual(rect(slot).right - 0.5);
      expect(rect(heading).right).toBeLessThanOrEqual(rect(drawer).right + 0.5);
      expect(rect(heading).height).toBeGreaterThan(rect(glyph).height);
      expect(rect(glyph).top).toBeLessThan(rect(heading).top + 16);
    });
  }
});

function Tabs({ inset, body }: { inset: "none" | "sm" | "md"; body: "padded" | "flush" }) {
  return (
    <ContentTabs
      value="a"
      onValueChange={() => undefined}
      label={`Inset ${inset} ${body}`}
      inset={inset}
      body={body}
      items={[
        { value: "a", label: "People", count: 5, content: <p data-testid="content">Panel</p> },
        { value: "b", label: "Billing", content: <p>Billing</p> },
      ]}
    />
  );
}

describe("content tabs with a side inset", () => {
  const OFFSETS = { none: 0, sm: 16, md: 24 } as const;
  for (const width of [600, 320]) {
    /** @scenario "A side inset keeps the strip's rule full width" */
    it(`starts the tabs and panel at 0, 16 and 24px with the rule full width at ${width}px`, () => {
      renderWithDesignSystem(
        <VStack align="stretch" gap={6} style={{ width }}>
          {(["none", "sm", "md"] as const).flatMap((inset) =>
            (["padded", "flush"] as const).map((body) => (
              <Tabs key={`${inset}-${body}`} inset={inset} body={body} />
            )),
          )}
        </VStack>,
      );

      for (const inset of ["none", "sm", "md"] as const) {
        for (const body of ["padded", "flush"] as const) {
          const list = screen.getByRole("tablist", { name: `Inset ${inset} ${body}` });
          const root = list.closest("[data-look]");
          const strip = list.parentElement;
          const panel = root?.querySelector("[role=tabpanel]:not([hidden])");
          const content = panel?.querySelector("[data-testid=content]");
          if (!root || !strip || !content) throw new Error(`no tabs ${inset} ${body}`);
          const label = `${inset} ${body}`;
          expect(rect(list).left - rect(root).left, `${label} list`).toBeCloseTo(OFFSETS[inset], 0);
          expect(rect(content).left - rect(root).left, `${label} panel`).toBeCloseTo(
            OFFSETS[inset],
            0,
          );
          expect(rect(strip).width, `${label} rule`).toBeCloseTo(rect(root).width, 0);
          expect(getComputedStyle(strip).borderBottomWidth, `${label} rule`).toBe("1px");
          expect(rect(content).right, `${label} right`).toBeLessThanOrEqual(rect(root).right + 0.5);
        }
      }
    });
  }
});

describe("a dialog that ignores an outside click", () => {
  function Secret({ onClose, outside }: { onClose: () => void; outside: boolean }) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Your new token"
        closeOnInteractOutside={outside}
        primaryAction={{ label: "Done", onClick: () => undefined }}
      />
    );
  }

  async function clickOutside() {
    const positioner = document.querySelector<HTMLElement>(
      "[data-scope='dialog'][data-part='positioner']",
    );
    if (!positioner) throw new Error("no dialog positioner");
    await userEvent.click(positioner, { position: { x: 4, y: 4 } });
  }

  /** @scenario "A secret dialog ignores an outside click but closes by X or Escape" */
  it("stays open on a real outside click, then closes once by the X and once by Escape", async () => {
    let closes = 0;
    renderWithDesignSystem(<Secret onClose={() => (closes += 1)} outside={false} />);
    const dialog = await screen.findByRole("dialog", { name: "Your new token" });

    await clickOutside();
    expect(closes).toBe(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(closes).toBe(1);
    await userEvent.keyboard("{Escape}");
    expect(closes).toBe(2);
  });

  /** @scenario "A secret dialog ignores an outside click but closes by X or Escape" */
  it("still closes on a real outside click by default", async () => {
    let closes = 0;
    renderWithDesignSystem(<Secret onClose={() => (closes += 1)} outside />);
    await screen.findByRole("dialog", { name: "Your new token" });

    await clickOutside();
    await waitFor(() => expect(closes).toBe(1));
  });
});

describe("a counted tab in a real browser", () => {
  /** @scenario "A counted tab has a separated accessible name" */
  it("is named People 5, Teams 0 and Audit, and arrow keys still move between tabs", async () => {
    renderWithDesignSystem(
      <ContentTabs
        value="people"
        onValueChange={() => undefined}
        label="Counted"
        items={[
          { value: "people", label: "People", count: 5, content: <p>People</p> },
          { value: "teams", label: "Teams", count: 0, content: <p>Teams</p> },
          { value: "audit", label: "Audit", count: undefined, content: <p>Audit</p> },
        ]}
      />,
    );

    const people = screen.getByRole("tab", { name: "People 5" });
    expect(screen.getByRole("tab", { name: "Teams 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Audit" })).toBeTruthy();
    people.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Teams 0" }));
  });
});
