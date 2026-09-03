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
} from "../setup-with-agent-button";
import { setTraceErrorHost } from "../errors";
import type { TraceFailureNotice, TraceHostPort } from "../../../behavior/trace-host";

const canAskMock = vi.fn(() => true);
vi.mock("../../../behavior/langy/use-can-ask-langy", () => ({
  useCanAskLangy: () => canAskMock(),
}));

const { toasterCreateMock } = vi.hoisted(() => ({
  toasterCreateMock: vi.fn(),
}));
vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: toasterCreateMock },
}));

const askLangyMock = vi.fn();
vi.mock("@langwatch/langy-web", () => ({
  useLangyStore: (
    selector: (s: { askLangy: (p: string) => void }) => unknown,
  ) => selector({ askLangy: askLangyMock }),
}));

vi.mock("../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1" },
    organization: { id: "org_1" },
  }),
}));

/** What the server answers with: the skill on its own, no credentials. */
let mockSkillBody: string | undefined;
const getPromptQueryMock = vi.fn(() => ({ data: mockSkillBody }));
vi.mock("../trace-api", () => ({
  api: {
    setupSkills: {
      getPrompt: {
        useQuery: (...args: unknown[]) => {
          const result = getPromptQueryMock(...(args as []));
          return { data: result.data ? { body: result.data } : undefined };
        },
      },
    },
  },
}));

/**
 * `generate-setup-skill-bodies.ts` (the source of truth for this list) lives
 * in `@langwatch/langy-server` and touches `node:fs` — a browser-web package
 * may not import it (frontend-boundary lint). Mirrored here rather than
 * imported; keep this list in sync with `SETUP_SKILL_IDS` by hand.
 */
const KNOWN_SKILLS: readonly string[] = [
  "connect-agent",
  "datasets",
  "experiments",
  "online-evaluations",
  "prompts",
  "scenarios",
  "tracing",
];

/** The surfaces whose prompt asks Langy to open the repository first. */
const REPO_CONNECTED: SetupSurface[] = [
  "connectedAgents",
  "traces",
  "experiments",
  "simulations",
  "simulationRuns",
];

function renderButton({
  surface,
  apiKey,
}: {
  surface: SetupSurface;
  apiKey?: string;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SetupWithAgentButton surface={surface} apiKey={apiKey} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
  mockSkillBody = undefined;
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
      renderButton({ surface: "traces" });
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
      renderButton({ surface: "simulations" });

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      const copy = await screen.findByText(
        "Copy a prompt for your coding agent",
      );
      const langy = screen.getByText("Ask Langy to set it up");
      screen.getByText(/read the agent testing documentation/i);

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
      renderButton({ surface: "datasets" });

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
      mockSkillBody = "# Add LangWatch Tracing to Your Code\n\n## Step 1";
      const user = userEvent.setup();
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderButton({ surface: "traces" });

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await user.click(
        await screen.findByText("Copy a prompt for your coding agent"),
      );

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(mockSkillBody),
      );
    });

    /** @scenario The copied prompt leads with the project's keys */
    it("puts the minted token above the skill without sending it to the server", async () => {
      mockSkillBody = "# Add LangWatch Tracing to Your Code";
      const user = userEvent.setup();
      const writeText = vi.fn((_text: string) => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderButton({ surface: "traces", apiKey: "sk-lw-minted" });

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await user.click(
        await screen.findByText("Copy a prompt for your coding agent"),
      );

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          expect.stringContaining('LANGWATCH_API_KEY="sk-lw-minted"'),
        ),
      );
      const copied = writeText.mock.calls[0]?.[0] ?? "";
      expect(copied.indexOf("Use these keys to instrument:")).toBe(0);
      expect(copied.indexOf(mockSkillBody)).toBeGreaterThan(0);

      // A tRPC query is a GET, so a token in its input would be written
      // into every log that records a URL.
      expect(getPromptQueryMock).toHaveBeenCalledWith(
        { projectId: "project_1", skill: "tracing" },
        expect.objectContaining({ enabled: true }),
      );
    });

    /** @scenario The install line stands in until the skill arrives */
    it("falls back to the install line while the skill is on its way", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn(() => Promise.resolve());
      // navigator.clipboard is getter-only in jsdom; redefine over
      // whatever user-event installed so the component's call is observable.
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderButton({ surface: "traces" });

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

    /** @scenario Copying the prompt confirms and survives a denied clipboard */
    it("reports the failure when the clipboard is denied", async () => {
      // Failure reporting travels WHOLE to the mounted TraceHostPort rather
      // than raising a toast directly (see show-error-toast.ts) — what is
      // asserted here is that the refusal was HANDED OVER, not what it was
      // made to say, mirroring use-export-traces.integration.test.ts.
      const failures: TraceFailureNotice[] = [];
      setTraceErrorHost({
        failed: (failure: TraceFailureNotice) => failures.push(failure),
      } as unknown as TraceHostPort);

      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
        configurable: true,
      });
      renderButton({ surface: "traces" });

      await user.click(
        screen.getByRole("button", { name: /setup via agent/i }),
      );
      await user.click(
        await screen.findByText("Copy a prompt for your coding agent"),
      );

      await waitFor(() => expect(failures).toHaveLength(1));
      expect(failures[0]?.fallbackTitle).toBe("Couldn't copy the prompt");

      setTraceErrorHost(void 0);
    });
  });

  describe("when the docs entry is followed", () => {
    it("links the surface's documentation overview", async () => {
      const user = userEvent.setup();
      renderButton({ surface: "prompts" });

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
