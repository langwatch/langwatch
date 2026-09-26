/**
 * Real-Chromium paint-order test for the Langy home's lit block: jsdom paints
 * nothing, so only a browser can say which layer ends up on top of a card.
 * Spec: specs/home/langy-home.feature
 */
import {
  Box,
  ChakraProvider,
  Container,
  defaultSystem,
  VStack,
} from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "my-project" },
  }),
}));

vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));

vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (s: unknown) => unknown) =>
    selector({ askLangy: vi.fn() }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...(rest as Record<string, unknown>)}>{children}</a>
  ),
}));

import { HomeCard } from "../HomeCard";
import { HomePageBanners } from "../HomePageBanners";

/** The home's own shape: a card directly above the block, inside its bleed. */
function Home() {
  return (
    <Container maxW="7xl" padding={5} position="relative" zIndex={1}>
      <VStack gap={4} width="full" align="start">
        <Box width="full" data-testid="card-above">
          <HomeCard>
            <Box padding={4} height="80px">
              Waiting to join
            </Box>
          </HomeCard>
        </Box>
        <Box width="full">
          <HomePageBanners variant="lantern">
            <Box height="320px">Good afternoon</Box>
          </HomePageBanners>
        </Box>
      </VStack>
    </Container>
  );
}

function mount(mode: "light" | "dark") {
  document.documentElement.className = mode;
  return render(
    <ChakraProvider value={defaultSystem}>
      <Home />
    </ChakraProvider>,
  );
}

/**
 * The bleed layers opt out of hit-testing, which also hides them from
 * elementFromPoint. Opting them back in lets the probe report paint order.
 */
function makeBleedHitTestable(container: HTMLElement) {
  const layers = container.querySelectorAll<HTMLElement>(
    "[aria-hidden='true']",
  );
  for (const layer of layers) layer.style.pointerEvents = "auto";
  return layers.length;
}

function topmostAt(element: HTMLElement, { x, y }: { x: number; y: number }) {
  const box = element.getBoundingClientRect();
  return document.elementFromPoint(
    box.left + box.width * x,
    box.top + box.height * y,
  );
}

describe("the Langy home's lit block", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = "";
  });

  for (const mode of ["light", "dark"] as const) {
    describe(`in ${mode} mode`, () => {
      /** @scenario "The block's light stays behind the cards around it" */
      it("paints the card above it over the block's light", () => {
        const { container } = mount(mode);
        expect(makeBleedHitTestable(container)).toBeGreaterThan(0);

        const card = screen.getByTestId("card-above");
        for (const point of [
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ]) {
          const hit = topmostAt(card, point);
          expect(hit).not.toBeNull();
          expect(card.contains(hit)).toBe(true);
        }
      });
    });
  }
});
