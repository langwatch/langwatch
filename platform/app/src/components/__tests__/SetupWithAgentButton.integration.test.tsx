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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1" },
    organization: { id: "org_1" },
  }),
}));

/** What the server answers with: the skill itself, keys on top when minted. */
let mockSkillPrompt: string | undefined;
const getPromptQueryMock = vi.fn(() => ({ data: mockSkillPrompt }));
vi.mock("~/utils/api", () => ({
  api: {
    setupSkills: {
      getPrompt: {
        useQuery: (...args: unknown[]) => {
          const result = getPromptQueryMock(...(args as []));
          return { data: result.data ? { prompt: result.data } : undefined };
        },
      },
    },
  },
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

function renderButton(surface: SetupSurface, apiKey?: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SetupWithAgentButton surface={surface} apiKey={apiKey} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
  mockSkillPrompt = undefined;
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
  describe("when the button renders on any surface", () => {
    /** @scenario the traces empty state keeps Setup via Agent on every project */
    it("reads Setup via Agent with no per-surface override", () => {
      renderButton("traces");
      expect(
        screen.getByRole("button", { name: /setup via agent/i }),
      ).toBeDefined();
      expect(screen.queryByText(/connect your agent/i)).toBeNull();
    });
  });

  describe("when the reader can ask Langy", () => {
    /** @scenario The coding-agent prompt is offered first */
    it("offers all three routes, copy first, and hands the surface prompt to Langy", async () => {
      const user = userEvent.setup();
      renderButton("simulations");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      const copy = await screen.findByText(
        "Copy a prompt for your coding agent",
      );
      const langy = screen.getByText("Ask Langy to set it up");
      screen.getByText(/read the simulations documentation/i);

      // Copy comes first, Langy second.
      expect(
        copy.compareDocumentPosition(langy) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await user.click(langy);
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
    /** @scenario The copied prompt carries the skill's own instructions */
    it("writes the skill itself once the server answers", async () => {
      mockSkillPrompt = "# Add LangWatch Tracing to Your Code\n\n## Step 1";
      const user = userEvent.setup();
      const writeText = vi.fn(() => Promise.resolve());
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
        expect(writeText).toHaveBeenCalledWith(mockSkillPrompt),
      );
    });

    /** @scenario The copied prompt leads with the project's keys */
    it("asks the server for the prompt with the minted token", async () => {
      const user = userEvent.setup();
      renderButton("traces", "sk-lw-minted");

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await screen.findByText("Copy a prompt for your coding agent");

      expect(getPromptQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ skill: "tracing", apiKey: "sk-lw-minted" }),
        expect.objectContaining({ enabled: true }),
      );
    });

    /** @scenario Copying the prompt confirms and survives a denied clipboard */
    it("falls back to the install line while the skill is on its way", async () => {
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

  describe("when the docs entry is followed", () => {
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
