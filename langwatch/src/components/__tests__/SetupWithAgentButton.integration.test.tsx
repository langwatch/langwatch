/**
 * @vitest-environment jsdom
 *
 * The set-up-with-AI control every empty state carries (spec:
 * specs/skills/empty-state-skill-setup.feature). The config pins guard the
 * surface-to-skill mapping and the repo-connect rule; the rendered cases
 * cover the menu's three routes and the Langy gate.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETUP_SURFACES,
  type SetupSurface,
  SetupWithAgentButton,
  setupAgentPrompt,
} from "../SetupWithAgentButton";

const canAskMock = vi.fn(() => true);
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => canAskMock(),
}));

const toasterCreateMock = vi.fn();
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toasterCreateMock(...args) },
}));

const askLangyMock = vi.fn();
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (
    selector: (s: { askLangy: (p: string) => void }) => unknown,
  ) => selector({ askLangy: askLangyMock }),
}));

const KNOWN_SKILLS = [
  "tracing",
  "experiments",
  "online-evaluations",
  "scenarios",
  "prompts",
  "datasets",
];

const REPO_CONNECTED: SetupSurface[] = [
  "traces",
  "experiments",
  "simulations",
  "simulationRuns",
];

function renderButton(surface: SetupSurface) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SetupWithAgentButton surface={surface} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
});

describe("SETUP_SURFACES", () => {
  /** @scenario Every empty surface offers its own skill */
  it("maps every surface to a real docs skill", () => {
    for (const [surface, setup] of Object.entries(SETUP_SURFACES)) {
      expect(KNOWN_SKILLS, `${surface} must use a known skill`).toContain(
        setup.skill,
      );
      expect(setup.docsUrl).toMatch(/^https:\/\/(docs\.)?langwatch\.ai\//);
    }
  });

  it("shares the online-evaluations skill between evaluators and online evaluations", () => {
    expect(SETUP_SURFACES.evaluators.skill).toBe("online-evaluations");
    expect(SETUP_SURFACES.onlineEvaluations.skill).toBe("online-evaluations");
  });

  /** @scenario Repo-connected surfaces ask Langy to connect the repository */
  it("asks Langy to connect the repository only on the code-landing surfaces", () => {
    for (const surface of Object.keys(SETUP_SURFACES) as SetupSurface[]) {
      const mentionsRepo = /repositor/i.test(
        SETUP_SURFACES[surface].langyPrompt,
      );
      expect(mentionsRepo, `${surface} repo-connect expectation`).toBe(
        REPO_CONNECTED.includes(surface),
      );
    }
  });
});

describe("setupAgentPrompt()", () => {
  it("installs the surface's skill rather than reciting its steps", () => {
    for (const surface of Object.keys(SETUP_SURFACES) as SetupSurface[]) {
      const prompt = setupAgentPrompt(surface);
      expect(prompt).toContain(
        `npx skills add langwatch/skills/${SETUP_SURFACES[surface].skill}`,
      );
      expect(prompt).toContain("https://langwatch.ai/docs/skills/directory");
    }
  });
});

describe("SetupWithAgentButton", () => {
  describe("when the reader can ask Langy", () => {
    /** @scenario Langy is offered first where the reader can ask */
    it("offers all three routes and hands the surface prompt to Langy", async () => {
      const user = userEvent.setup();
      renderButton("simulations");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await screen.findByText("Ask Langy to set it up");
      screen.getByText("Copy a prompt for your coding agent");
      screen.getByText(/read the simulations documentation/i);

      await user.click(screen.getByText("Ask Langy to set it up"));
      expect(askLangyMock).toHaveBeenCalledWith(
        SETUP_SURFACES.simulations.langyPrompt,
      );
    });
  });

  describe("when the reader cannot ask Langy", () => {
    /** @scenario Langy stays out of the menu where the reader cannot ask */
    it("keeps the copy and docs routes but drops the Langy one", async () => {
      canAskMock.mockReturnValue(false);
      const user = userEvent.setup();
      renderButton("datasets");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await screen.findByText("Copy a prompt for your coding agent");
      expect(screen.queryByText("Ask Langy to set it up")).toBeNull();
      screen.getByText(/read the datasets documentation/i);
    });
  });

  describe("when copying the prompt", () => {
    /** @scenario Copying the prompt confirms and survives a denied clipboard */
    it("writes the skill-install prompt to the clipboard", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn(() => Promise.resolve());
      // navigator.clipboard is getter-only in jsdom; redefine over
      // whatever user-event installed so the component's call is observable.
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderButton("traces");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await user.click(
        await screen.findByText("Copy a prompt for your coding agent"),
      );

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(setupAgentPrompt("traces")),
      );
      await waitFor(() =>
        expect(toasterCreateMock).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        ),
      );
    });

    it("reports the failure when the clipboard is denied", async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
        configurable: true,
      });
      renderButton("traces");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await user.click(
        await screen.findByText("Copy a prompt for your coding agent"),
      );

      await waitFor(() =>
        expect(toasterCreateMock).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error" }),
        ),
      );
    });
  });

  describe("the docs route", () => {
    it("links the surface's documentation overview", async () => {
      const user = userEvent.setup();
      renderButton("prompts");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      const docs = await screen.findByText(
        /read the prompt management documentation/i,
      );
      expect(docs.closest("a")).toHaveAttribute(
        "href",
        SETUP_SURFACES.prompts.docsUrl,
      );
    });
  });
});
