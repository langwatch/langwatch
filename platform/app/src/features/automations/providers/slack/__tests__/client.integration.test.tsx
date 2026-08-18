/**
 * @vitest-environment jsdom
 *
 * The Slack notification config is a layered authoring flow: the guided
 * preset gallery is the default surface, with plain text and raw Block Kit
 * as opt-in escape hatches. These tests pin the disclosure structure — a
 * fresh draft lands on the gallery with no code in sight, and each deeper
 * tier is revealed only on request — plus the slice write when a preset is
 * picked. Monaco cannot mount in jsdom, so it is stubbed; the editors are
 * asserted through their wrapper test ids.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "~/features/automations/providers/types";

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
/** Whether the caller holds `project:update` at this project — the permission
 *  the switch-to-integration write needs, so the affordance is gated on it. */
const canManageProject: { current: boolean } = { current: true };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "project-1", name: "Project" },
    organization: { id: "org-1", name: "Org" },
    team: { id: "team-1", slug: "team-1", name: "Team" },
    hasPermission: () => canManageProject.current,
  }),
}));
vi.mock("~/components/ui/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));
/** Channels the mocked listSlackChannels mutation has "already loaded". Tests
 *  that care about the picker set this before rendering. */
const listedChannels: { current: { id: string; name: string }[] | undefined } =
  {
    current: undefined,
  };
/** Why the listing is short of the workspace, as the server would report it. */
const listedGaps: { current: string[] } = { current: [] };
/** A server-reported listing failure (`missing_scope`, `no_token`, …) on
 *  `data.error` — distinct from a transport-level mutation failure below. */
const listedError: { current: string | null } = { current: null };
/** A transport-level mutation failure (`list.isError` / `list.error`) — the
 *  request itself never got an answer, as opposed to a valid answer that
 *  names a problem. */
const mutationError: { current: unknown } = { current: null };
/** Every call the form made to `listSlackChannels.mutate`, so a test can
 *  assert Reload actually re-fires the request rather than silently doing
 *  nothing. */
const mutateCalls: { projectId: string; botToken: string | null }[] = [];
/** Stable empty-array fallback for `listedChannels.current` — a fresh `[]`
 *  literal on every mocked render would break the component's "sync the
 *  collection from a stable reference" effect and loop it forever. */
const NO_CHANNELS: { id: string; name: string }[] = [];

/** Whether the PROJECT has a Slack integration (ADR-093 §5) — the fact that
 *  decides which of the composer's three token states renders. */
const projectIntegration: {
  current: { connected: boolean; slackTeamName: string | null };
} = { current: { connected: false, slackTeamName: null } };
/** The integration status query still in flight. While it is, the composer must
 *  not claim Slack is unconnected — that is a guess rendered as a statement. */
const integrationPending: { current: boolean } = { current: false };
/** Every "switch this automation onto the project integration" call. */
const switchCalls: { projectId: string; automationIds?: string[] }[] = [];

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      automation: {
        getTriggers: { invalidate: () => undefined },
      },
      slackIntegration: {
        getLegacyTokenCensus: { invalidate: () => undefined },
      },
    }),
    slackIntegration: {
      getStatus: {
        useQuery: () => ({
          data: projectIntegration.current,
          isLoading: integrationPending.current,
        }),
      },
      switchToIntegration: {
        useMutation: () => ({
          mutate: (args: { projectId: string; automationIds?: string[] }) =>
            switchCalls.push(args),
          isPending: false,
          isError: false,
          error: null,
        }),
      },
    },
    automation: {
      getTriggers: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      listSlackChannels: {
        useMutation: () => ({
          mutate: (
            args: { projectId: string; botToken: string | null },
            opts?: { onError?: (error: unknown) => void },
          ) => {
            mutateCalls.push(args);
            if (mutationError.current) opts?.onError?.(mutationError.current);
          },
          data:
            listedChannels.current || listedError.current
              ? {
                  channels: listedChannels.current ?? NO_CHANNELS,
                  gaps: listedGaps.current,
                  error: listedError.current,
                }
              : undefined,
          isPending: false,
          isError: !!mutationError.current,
          error: mutationError.current,
        }),
      },
    },
  },
}));

import {
  SLACK_BOT_TOKEN_KEPT,
  type SlackPreview,
} from "@langwatch/automations/providers/slack";
import slackClient, { type SlackSlice, slackTokenState } from "../client";
import {
  SLACK_BLOCK_KIT_TEMPLATES,
  templateOptionsFor,
} from "../templates/registry";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeCtx(
  overrides: Partial<ConfigFormCtx<SlackPreview>> = {},
): ConfigFormCtx<SlackPreview> {
  return {
    projectId: "project-1",
    organizationId: "org-1",
    teamSlug: "team-1",
    variables: [],
    example: {},
    preview: {
      channel: "slack",
      usedDefault: true,
      missingVariables: [],
      errors: [],
      payload: { blocks: [{ type: "section" }] },
    },
    previewLoading: false,
    cadenceMode: "immediate",
    notificationCadence: "immediate",
    setNotificationCadence: vi.fn(),
    hasEvaluationFilter: false,
    sourceKind: "trace",
    ...overrides,
  };
}

/** Stateful harness so onChange actually re-renders the form (a mode switch
 *  in the real drawer flows back through the draft store). onChangeSpy lets a
 *  test assert the exact slice written. */
function Harness({
  ctx,
  initial,
  onChangeSpy,
}: {
  ctx: ConfigFormCtx<SlackPreview>;
  initial?: SlackSlice;
  onChangeSpy?: (next: SlackSlice) => void;
}) {
  const [slice, setSlice] = useState<SlackSlice>(
    initial ?? slackClient.initialSlice(),
  );
  const Form = slackClient.ConfigForm;
  return (
    <Form
      slice={slice}
      ctx={ctx}
      onChange={(next) => {
        onChangeSpy?.(next);
        setSlice(next);
      }}
    />
  );
}

const renderForm = (
  props: {
    ctx?: ConfigFormCtx<SlackPreview>;
    initial?: SlackSlice;
    onChangeSpy?: (next: SlackSlice) => void;
  } = {},
) =>
  render(
    <Harness
      ctx={props.ctx ?? makeCtx()}
      initial={props.initial}
      onChangeSpy={props.onChangeSpy}
    />,
    {
      wrapper: Wrapper,
    },
  );

const botSlice = (overrides: Partial<SlackSlice> = {}): SlackSlice => ({
  ...slackClient.initialSlice(),
  deliveryMethod: "bot",
  channelId: "C0123",
  ...overrides,
});

/** Stateful cadence host: the chooser writes through
 *  `setNotificationCadence` and the value flows back down as
 *  `notificationCadence` / `cadenceMode`, the way the draft store wires the
 *  real form owner. */
function CadenceHarness() {
  const [cadence, setCadence] =
    useState<ConfigFormCtx["notificationCadence"]>("immediate");
  const [slice, setSlice] = useState<SlackSlice>(slackClient.initialSlice());
  const Form = slackClient.ConfigForm;
  return (
    <Form
      slice={slice}
      ctx={makeCtx({
        notificationCadence: cadence,
        cadenceMode: cadence === "immediate" ? "immediate" : "digest",
        setNotificationCadence: setCadence,
      })}
      onChange={setSlice}
    />
  );
}

describe("SlackConfigForm authoring tiers", () => {
  afterEach(() => cleanup());

  describe("given the receive chooser rendered beside the layouts", () => {
    /** @scenario "The receive choice decides which layouts are offered" */
    it("filters the layout list to the chosen mode", async () => {
      const user = userEvent.setup();
      render(<CadenceHarness />, { wrapper: Wrapper });

      expect(
        screen.getByRole("option", { name: /compact notice/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /digest — compact/i }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("radio", { name: /in batches/i }));

      expect(
        screen.getByRole("option", { name: /digest — compact/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /compact notice/i }),
      ).not.toBeInTheDocument();
    });

    it("is not offered to a report, whose timing is its schedule", () => {
      renderForm({
        ctx: makeCtx({ sourceKind: "report", reportSourceKind: "traceQuery" }),
      });

      expect(
        screen.queryByText("How do you want to receive messages?"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a fresh block_kit draft", () => {
    describe("when the form first renders", () => {
      it("shows the guided layout picker", () => {
        renderForm();

        expect(
          screen.getByRole("option", { name: /compact notice/i }),
        ).toBeInTheDocument();
      });

      it("keeps the code editor hidden", () => {
        renderForm();

        expect(
          screen.queryByTestId("slack-code-editor"),
        ).not.toBeInTheDocument();
      });

      it("renders the synced preview", () => {
        renderForm();

        expect(
          screen.getByText(/preview in slack's block kit builder/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("when a preset is picked", () => {
    it("writes the preset source to the slice", () => {
      const onChangeSpy = vi.fn();
      const [firstOption] = templateOptionsFor({
        cadence: "immediate",
        kind: "trace",
      });
      renderForm({ onChangeSpy });

      fireEvent.click(
        screen.getByRole("option", {
          name: new RegExp(firstOption!.displayName, "i"),
        }),
      );

      expect(onChangeSpy).toHaveBeenCalledTimes(1);
      expect(onChangeSpy.mock.calls[0]![0]).toMatchObject({
        templateType: "block_kit",
        template: { value: firstOption!.source, usingDefault: false },
      });
    });
  });

  // A report's layout follows its content source, so the draft carries the
  // matching layout from the start. It is still the DEFAULT, though — the author
  // has customised nothing. A draft that claimed otherwise would show a
  // hand-customised field on a pristine report and turn Reset into a no-op.
  describe("given a fresh report draft", () => {
    const reportCtx = () =>
      makeCtx({ sourceKind: "report", reportSourceKind: "traceQuery" });
    const layoutFor = (id: string) =>
      SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.id === id)!;

    it("seeds the layout that matches what the report sends", () => {
      const onChangeSpy = vi.fn();
      renderForm({ ctx: reportCtx(), onChangeSpy });

      expect(onChangeSpy).toHaveBeenCalledTimes(1);
      expect(onChangeSpy.mock.calls[0]![0]).toMatchObject({
        template: {
          value: layoutFor("report_table").source,
          usingDefault: true,
        },
      });
    });

    it("stores the seeded layout, so the message sent is the one shown", () => {
      const seeded: SlackSlice = {
        ...slackClient.initialSlice(),
        template: {
          value: layoutFor("report_table").source,
          usingDefault: true,
        },
      };

      expect(slackClient.templatesFromSlice(seeded).slackTemplate).toBe(
        layoutFor("report_table").source,
      );
    });
  });

  describe("when the author switches to the Code tab", () => {
    it("reveals the raw Block Kit editor", async () => {
      const user = userEvent.setup();
      renderForm();

      // "Code" is a segmented-control tab beside "Template", not a buried
      // "edit as code" disclosure (the drawer UX rework).
      await user.click(screen.getByRole("radio", { name: "Code" }));

      expect(
        await screen.findByTestId("slack-code-editor"),
      ).toBeInTheDocument();
    });
  });

  describe("when the author switches to plain text", () => {
    it("reveals the plain text editor and drops the layout picker", () => {
      renderForm();

      fireEvent.click(
        screen.getByRole("button", {
          name: /write the message as plain text/i,
        }),
      );

      expect(screen.getByTestId("slack-text-editor")).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /compact notice/i }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("SlackConfigForm delivery method", () => {
  afterEach(() => {
    cleanup();
    projectIntegration.current = { connected: false, slackTeamName: null };
    integrationPending.current = false;
    canManageProject.current = true;
    switchCalls.length = 0;
  });

  // A guess rendered as a statement is the failure here: telling an author with
  // Slack connected that it is not, and taking the channel picker away while
  // saying it, for as long as the query is in flight.
  describe("given a fresh draft whose integration status has not landed yet", () => {
    it("waits instead of claiming Slack is not connected", () => {
      integrationPending.current = true;
      renderForm();

      expect(screen.getByTestId("slack-state-loading")).toBeInTheDocument();
      expect(
        screen.queryByText(/slack isn.t connected for this project/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a fresh draft in a project with Slack connected", () => {
    beforeEach(() => {
      projectIntegration.current = {
        connected: true,
        slackTeamName: "Acme HQ",
      };
    });

    /** @scenario "The composer only asks for a channel" */
    it("offers a channel from the connected workspace and no token field", () => {
      renderForm();

      expect(
        screen.getByPlaceholderText(/#alerts or c0123/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/acme hq slack workspace/i)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/xoxb-/i)).not.toBeInTheDocument();
      // A new automation cannot pick a webhook — no field, no connection toggle.
      expect(
        screen.queryByPlaceholderText(/hooks\.slack\.com/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("radio", { name: /incoming webhook/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a fresh draft in a project with no Slack integration", () => {
    /** @scenario "The composer can tell the three token states apart" */
    it("reads as needing Slack connected, and asks for no token", () => {
      renderForm();

      expect(
        screen.getByText(/slack isn.t connected for this project/i),
      ).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/xoxb-/i)).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText(/#alerts or c0123/i),
      ).not.toBeInTheDocument();
    });

    /** @scenario "The author is guided to connect Slack for the project" */
    it("points at the project's integration settings", () => {
      renderForm();

      expect(
        screen.getByRole("link", { name: /connect slack for this project/i }),
      ).toHaveAttribute("href", "/settings/integrations");
    });
  });

  describe("given a saved webhook automation (legacy)", () => {
    const legacySlice = (): SlackSlice => ({
      ...slackClient.initialSlice(),
      deliveryMethod: "webhook",
      isLegacyWebhook: true,
      webhook: "https://hooks.slack.com/services/T000/B000/xyz",
    });

    it("keeps the webhook editable and offers an upgrade to a Slack app", () => {
      renderForm({ initial: legacySlice() });

      expect(
        screen.getByPlaceholderText(/hooks\.slack\.com/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /incoming webhook/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /switch to a slack app/i }),
      ).toBeInTheDocument();
    });

    it("can switch to a bot connection", async () => {
      const user = userEvent.setup();
      projectIntegration.current = {
        connected: true,
        slackTeamName: "Acme HQ",
      };
      renderForm({ initial: legacySlice() });

      await user.click(screen.getByRole("radio", { name: /slack app/i }));

      expect(
        await screen.findByPlaceholderText(/#alerts or c0123/i),
      ).toBeInTheDocument();
    });
  });

  describe("given a bot draft whose token is already stored", () => {
    /** @scenario "The composer can tell the three token states apart" */
    it("reads as using its own token, whatever the project has connected", () => {
      renderForm({ initial: botSlice({ botTokenAlreadySet: true }) });

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/xoxb-/i)).not.toBeInTheDocument();
    });

    /** @scenario "Switching a legacy automation to the project integration" */
    it("offers switching to the project integration once one is connected", async () => {
      const user = userEvent.setup();
      projectIntegration.current = {
        connected: true,
        slackTeamName: "Acme HQ",
      };
      renderForm({
        initial: botSlice({ botTokenAlreadySet: true }),
        ctx: makeCtx({ automationId: "automation-1" }),
      });

      await user.click(
        screen.getByRole("button", { name: /use the project integration/i }),
      );
      // The click asks; it does not act. Deleting the only copy of a
      // credential is not something a stray click gets to do.
      expect(switchCalls).toEqual([]);
      await user.click(
        await screen.findByRole("button", { name: /switch this automation/i }),
      );

      expect(switchCalls).toEqual([
        { projectId: "project-1", automationIds: ["automation-1"] },
      ]);
    });

    it("offers no switch to an author who cannot change the project", () => {
      projectIntegration.current = {
        connected: true,
        slackTeamName: "Acme HQ",
      };
      canManageProject.current = false;
      renderForm({
        initial: botSlice({ botTokenAlreadySet: true }),
        ctx: makeCtx({ automationId: "automation-1" }),
      });

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use the project integration/i }),
      ).not.toBeInTheDocument();
    });

    it("lets the author select a template that needs a Slack app", () => {
      renderForm({ initial: botSlice({ botTokenAlreadySet: true }) });

      expect(
        screen.getByRole("option", { name: /eval failure banner/i }),
      ).not.toHaveAttribute("aria-disabled");
    });
  });
});

describe("SlackConfigForm channel picker", () => {
  // The picker only renders where a token resolves (ADR-093 §5), and these
  // blocks are about the picker rather than about which token feeds it — so
  // the project's Slack integration is connected throughout unless a block
  // says otherwise.
  beforeEach(() => {
    projectIntegration.current = { connected: true, slackTeamName: "Acme HQ" };
  });

  afterEach(() => {
    cleanup();
    projectIntegration.current = { connected: false, slackTeamName: null };
    listedChannels.current = undefined;
    listedGaps.current = [];
    listedError.current = null;
    mutationError.current = null;
    mutateCalls.length = 0;
  });

  describe("given a workspace whose channels have loaded", () => {
    beforeEach(() => {
      // A shared prefix ("support", "support-escalations") and a term that
      // only bites late in the name ("signoff") are what a one-character
      // search cannot separate — which is the bug this block pins.
      listedChannels.current = [
        { id: "C001", name: "alerts" },
        { id: "C002", name: "build-status" },
        { id: "C003", name: "release-signoff" },
        { id: "C004", name: "support" },
        { id: "C005", name: "support-escalations" },
      ];
    });

    // Typed at a human cadence on purpose. The combobox resyncs the input
    // element from a passive effect, so back-to-back synthetic keystrokes with
    // no gap at all outrun React's effect flush and drop characters — a race no
    // typist can win, and not the bug under test.
    const typist = () => userEvent.setup({ delay: 10 });

    /**
     * Put a channel in the box in ONE input event, for the tests that are not
     * about typing.
     *
     * The race costs a character only because each keystroke is appended to
     * whatever the box is holding at that moment: if a resync rewrites the box
     * from stale text between two keystrokes, the next character lands on the
     * stale text and the one before it is gone from the combobox's own state
     * for good. A single event has no "between", so there is nothing to lose —
     * and this holds whatever it is that makes the resync late, which is worth
     * something, because that has not been pinned down.
     *
     * This is a real thing authors do (paste a channel name or an ID), and for
     * a test that goes on to blur, press Enter or pick from the list it says
     * exactly as much as typing did: the box holds the channel.
     */
    const enterChannel = async ({
      user,
      input,
      text,
    }: {
      user: ReturnType<typeof typist>;
      input: HTMLElement;
      text: string;
    }): Promise<void> => {
      await user.click(input);
      await user.paste(text);
      await waitFor(() => expect(input).toHaveValue(text));
    };

    /**
     * Type one character at a time, waiting for the box to hold each prefix
     * before sending the next.
     *
     * Only for the test whose subject IS the per-keystroke path — that the
     * search filters on the whole term rather than the last letter, which is
     * the defect that made a long channel name unreachable. Pasting would walk
     * straight past it, so that test keeps typing and this keeps it honest:
     * nothing is typed onto a box that is not already holding what came
     * before, so a stale value is caught while it is still recoverable rather
     * than being carried into the assertion.
     *
     * The tests that type and immediately assert the value use neither helper.
     * There the dropped character IS the assertion, and it should fail.
     *
     * `text` is literal text — key descriptors like `{Enter}` do not survive
     * being split per character.
     */
    const typeAndSettle = async ({
      user,
      input,
      text,
    }: {
      user: ReturnType<typeof typist>;
      input: HTMLElement;
      text: string;
    }): Promise<void> => {
      let typed = "";
      for (const character of text) {
        await user.type(input, character);
        typed += character;
        await waitFor(() => expect(input).toHaveValue(typed));
      }
    };

    describe("when the author types a channel name to search", () => {
      it("keeps every typed character in the box", async () => {
        const user = typist();
        renderForm({ initial: botSlice({ channelId: "" }) });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await user.click(input);
        await user.type(input, "signoff");

        expect(input).toHaveValue("signoff");
      });

      it("narrows the list by the whole search term, not just the last letter", async () => {
        const user = typist();
        renderForm({ initial: botSlice({ channelId: "" }) });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await user.click(input);
        await typeAndSettle({ user, input, text: "signoff" });

        expect(screen.getByText("#release-signoff")).toBeInTheDocument();
        expect(screen.queryByText("#support")).not.toBeInTheDocument();
      });

      // A long name is the case that broke: the box was rewritten on every
      // keystroke, so only the last character ever survived.
      it("keeps a long search term intact", async () => {
        const user = typist();
        renderForm({ initial: botSlice({ channelId: "" }) });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await user.type(input, "#adhoc");

        expect(input).toHaveValue("#adhoc");
      });

      it("carries the typed text into the slice on blur, so a channel that isn't listed still saves", async () => {
        const user = typist();
        const onChangeSpy = vi.fn();
        renderForm({ initial: botSlice({ channelId: "" }), onChangeSpy });

        await enterChannel({
          user,
          input: screen.getByPlaceholderText(/#alerts or c0123/i),
          text: "#adhoc",
        });
        await user.tab();

        expect(onChangeSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ channelId: "#adhoc" }),
        );
      });

      it("carries the typed text into the slice on Enter", async () => {
        const user = typist();
        const onChangeSpy = vi.fn();
        renderForm({ initial: botSlice({ channelId: "" }), onChangeSpy });

        await enterChannel({
          user,
          input: screen.getByPlaceholderText(/#alerts or c0123/i),
          text: "#adhoc",
        });
        await user.keyboard("{Enter}");

        expect(onChangeSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ channelId: "#adhoc" }),
        );
      });
    });

    describe("when the author picks a channel from the list", () => {
      it("stores the channel id and shows its name", async () => {
        const user = userEvent.setup();
        const onChangeSpy = vi.fn();
        renderForm({ initial: botSlice({ channelId: "" }), onChangeSpy });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await user.click(input);
        await user.click(await screen.findByText("#release-signoff"));

        expect(onChangeSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ channelId: "C003" }),
        );
        expect(input).toHaveValue("#release-signoff");
      });

      // Enter means two things in this field: commit what was typed, and
      // accept the highlighted suggestion. Both handlers fire on the same
      // keypress, so the one that lands LAST decides what gets saved — a
      // suggestion the author deliberately highlighted must beat the search
      // text they typed to find it.
      it("keeps the highlighted channel, not the search text, when Enter accepts a suggestion", async () => {
        const user = typist();
        const onChangeSpy = vi.fn();
        renderForm({ initial: botSlice({ channelId: "" }), onChangeSpy });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await enterChannel({ user, input, text: "signoff" });
        await user.keyboard("{ArrowDown}{Enter}");

        expect(onChangeSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ channelId: "C003" }),
        );
        expect(input).toHaveValue("#release-signoff");
      });
    });

    describe("when the author replaces a picked channel with a free-typed one", () => {
      // The picked channel stays the combobox's selection until something
      // moves it, so the list would keep a tick beside a channel that is no
      // longer the field's value.
      it("moves the tick off the channel it replaced", async () => {
        const user = typist();
        renderForm({ initial: botSlice({ channelId: "" }) });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await user.click(input);
        await user.click(await screen.findByText("#release-signoff"));
        await user.clear(input);
        await enterChannel({ user, input, text: "#adhoc" });
        await user.tab();
        await user.click(input);

        const checked = Array.from(
          document.querySelectorAll(
            '[data-scope="combobox"][data-part="item"][data-state="checked"]',
          ),
        ).map((el) => el.textContent);

        // The typed channel is the value, so it may carry the tick; the
        // channel it replaced must not.
        expect(checked).toEqual(["#adhoc"]);
      });

      // ...and moving that selection must not take the typed text with it:
      // the combobox rewrites its input from the selection, so CLEARING the
      // selection outright is exactly the move that blanks the box. This is
      // the guard on that — it fails if the fix regresses to setSelectedId("").
      it("keeps the typed channel in the box and in the slice", async () => {
        const user = typist();
        const onChangeSpy = vi.fn();
        renderForm({ initial: botSlice({ channelId: "" }), onChangeSpy });
        const input = screen.getByPlaceholderText(/#alerts or c0123/i);

        await user.click(input);
        await user.click(await screen.findByText("#release-signoff"));
        await user.clear(input);
        await enterChannel({ user, input, text: "#adhoc" });
        await user.tab();

        expect(input).toHaveValue("#adhoc");
        expect(onChangeSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ channelId: "#adhoc" }),
        );
      });
    });

    // A short list that looks complete is the failure mode being fixed: the
    // author scrolls, doesn't find their channel, and concludes the whole
    // integration is broken. Every way the list can come back short has to say
    // so, and point at the way through.
    describe("when the workspace has more channels than the fetch can return", () => {
      beforeEach(() => {
        listedGaps.current = ["page_cap"];
      });

      it("tells the author the list is incomplete", async () => {
        renderForm({ initial: botSlice({ channelId: "" }) });

        expect(
          await screen.findByText(/more channels than we can list/i),
        ).toBeInTheDocument();
      });

      it("points the author at entering the channel themselves", async () => {
        renderForm({ initial: botSlice({ channelId: "" }) });

        expect(
          await screen.findByText(/type the channel name or paste its id/i),
        ).toBeInTheDocument();
      });
    });

    // Reachable: an app with no groups:read whose public channels then outrun
    // the page budget. Ranking the two would have the author fix the scope and
    // still come up short.
    describe("when the list is short for more than one reason", () => {
      beforeEach(() => {
        listedGaps.current = ["page_cap", "private_channels_hidden"];
      });

      it("names every reason, not just the first", async () => {
        renderForm({ initial: botSlice({ channelId: "" }) });

        const hint = await screen.findByText(/private channels aren't listed/i);

        expect(hint).toHaveTextContent(/more channels than we can list/i);
      });
    });

    describe("when the app cannot see private channels", () => {
      beforeEach(() => {
        listedGaps.current = ["private_channels_hidden"];
      });

      it("names the permission that would show them", async () => {
        renderForm({ initial: botSlice({ channelId: "" }) });

        const hint = await screen.findByText(/private channels aren't listed/i);

        expect(hint).toHaveTextContent(/groups:read/);
      });
    });

    describe("when the list covers the whole workspace", () => {
      it("says nothing about the list being short", () => {
        renderForm({ initial: botSlice({ channelId: "" }) });

        expect(
          screen.queryByText(/more channels than we can list/i),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(/private channels aren't listed/i),
        ).not.toBeInTheDocument();
      });
    });

    // The Slack-app setup guidance no longer lives here: ADR-093 §5 moved it to
    // the project's integration settings card, where the token is now pasted
    // once. Its coverage moved with it (settings/__tests__).

    describe("given a saved automation whose channel id is already stored", () => {
      it("shows the channel name rather than the raw id", async () => {
        renderForm({ initial: botSlice({ channelId: "C003" }) });

        expect(
          await screen.findByDisplayValue("#release-signoff"),
        ).toBeInTheDocument();
      });
    });
  });

  // B2: the Reload button genuinely re-fires the mutation, but a failure used
  // to be swallowed to a console.error with nothing shown in the form, and a
  // manual reload with no usable token answered "no_token" with no hint at
  // all. Both now name their cause in the hint line under the field.
  describe("given a channel-list request that fails", () => {
    beforeEach(() => {
      listedChannels.current = [];
      mutationError.current = new Error("network down");
    });

    /** @scenario "A channel-list failure names its cause in the form" */
    it("names the failure in the hint under the field instead of only logging it", async () => {
      renderForm({ initial: botSlice({ channelId: "" }) });

      const hint = await screen.findByText(/couldn.t load channels/i);
      expect(hint).toHaveTextContent(/you can still type the channel above/i);
    });
  });

  describe("given a channel-list request answered with no_token", () => {
    beforeEach(() => {
      // A stable (if empty) array — `list.data?.channels` feeds a
      // sync-the-collection effect keyed on this reference, and a fresh `[]`
      // literal on every render would loop it forever.
      listedChannels.current = [];
      listedError.current = "no_token";
    });

    // Deliberately unbound: this pins the channel-list hint's copy, not which
    // token state the composer is in. The three states are asserted where they
    // are actually rendered and computed, above.
    it("names the missing project integration instead of showing nothing", async () => {
      renderForm({
        initial: botSlice({ channelId: "", botTokenAlreadySet: true }),
      });

      expect(
        await screen.findByText(/connect slack for this project to see its/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the author clicks Reload", () => {
    beforeEach(() => {
      listedChannels.current = [{ id: "C001", name: "alerts" }];
    });

    it("re-fires the channel listing request", async () => {
      const user = userEvent.setup();
      renderForm({
        initial: botSlice({ channelId: "", botTokenAlreadySet: true }),
      });

      // The mount effect already issues one request for the stored token.
      await screen.findByText("#alerts");
      const callsBeforeReload = mutateCalls.length;
      expect(callsBeforeReload).toBeGreaterThan(0);

      await user.click(screen.getByRole("button", { name: /reload/i }));

      expect(mutateCalls.length).toBeGreaterThan(callsBeforeReload);
    });
  });
});

describe("Slack client slice contract", () => {
  describe("given a bot slice", () => {
    describe("when the channel is set and a token is stored", () => {
      it("reports the config as complete without a typed token", () => {
        expect(
          slackClient.isComplete(botSlice({ botTokenAlreadySet: true })),
        ).toBe(true);
      });
    });

    // The token belongs to the project now (ADR-093 §5), so it is not something
    // the author has left unfinished — completeness is the channel.
    describe("when the channel is set and no token is stored", () => {
      /** @scenario "New automations rely on the project integration, not a token of their own" */
      it("reports the config as complete", () => {
        expect(
          slackClient.isComplete(botSlice({ botTokenAlreadySet: false })),
        ).toBe(true);
      });
    });

    describe("when the channel is not set", () => {
      /** @scenario "A bot automation is incomplete without a channel" */
      it("reports the config as incomplete", () => {
        expect(slackClient.isComplete(botSlice({ channelId: "" }))).toBe(false);
      });
    });

    describe("when no token exists anywhere", () => {
      /** @scenario "The composer can tell the three token states apart" */
      it("reads as needing Slack connected, and the preview drops gated blocks", () => {
        const slice = botSlice({ botTokenAlreadySet: false });
        expect(
          slackTokenState({ slice, projectIntegrationConnected: false }),
        ).toBe("not_connected");
        expect(
          slackClient.previewOptions?.({
            slice: slice,
            context: { hasProjectSlackIntegration: false },
          }),
        ).toEqual({ allowGatedBlocks: false });
      });
    });

    describe("when only the project integration exists", () => {
      /** @scenario "The composer can tell the three token states apart" */
      it("reads as using the project integration, and gated blocks render", () => {
        const slice = botSlice({ botTokenAlreadySet: false });
        expect(
          slackTokenState({ slice, projectIntegrationConnected: true }),
        ).toBe("project_integration");
        expect(
          slackClient.previewOptions?.({
            slice: slice,
            context: { hasProjectSlackIntegration: true },
          }),
        ).toEqual({ allowGatedBlocks: true });
      });
    });
  });

  // Token availability is necessary but not sufficient: a webhook strips the
  // modern blocks whatever credential is behind the project, so the preview
  // has to strip them too or it promises a chart Slack will drop.
  describe("given a webhook slice in a project with Slack connected", () => {
    /** @scenario "The richer templates are offered only for a bot connection" */
    it("still drops the gated blocks from the preview", () => {
      const slice: SlackSlice = {
        ...slackClient.initialSlice(),
        deliveryMethod: "webhook",
        isLegacyWebhook: true,
        webhook: "https://hooks.slack.com/services/T000/B000/xyz",
      };

      expect(
        slackClient.previewOptions?.({
          slice: slice,
          context: { hasProjectSlackIntegration: true },
        }),
      ).toEqual({ allowGatedBlocks: false });
    });

    describe("when a token is typed", () => {
      it("sends the typed token verbatim", () => {
        const params = slackClient.toActionParams(
          botSlice({ botToken: "xoxb-fresh", botTokenAlreadySet: false }),
        ) as { slackDelivery: string; slackBotToken?: string };

        expect(params.slackDelivery).toBe("bot");
        expect(params.slackBotToken).toBe("xoxb-fresh");
      });
    });

    describe("when the stored token is left untouched on edit", () => {
      it("sends the keep sentinel so the server keeps the stored token", () => {
        const params = slackClient.toActionParams(
          botSlice({ botToken: "", botTokenAlreadySet: true }),
        ) as { slackBotToken?: string };

        expect(params.slackBotToken).toBe(SLACK_BOT_TOKEN_KEPT);
      });
    });
  });
});
