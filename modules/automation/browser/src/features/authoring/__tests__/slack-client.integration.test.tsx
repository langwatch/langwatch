/**
 * @vitest-environment jsdom
 * The Slack step: connection picker, channel, receive chooser and template tiers. Monaco is
 * stubbed; the editors are asserted through their wrapper test ids.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type * as SlackKit from "@langwatch/slack-browser-kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigFormCtx } from "../../../model/provider-types.ts";

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
vi.mock("@langwatch/design-system/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));
/** Channels the mocked listSlackChannels mutation has "already loaded". Tests
 *  that care about the picker set this before rendering. */
const listedChannels: { current: { id: string; name: string }[] | undefined } = {
  current: undefined,
};
/** Why the listing is short of the workspace, as the server would report it. */
const listedGaps: { current: string[] } = { current: [] };
/** A server-reported listing failure (`missing_scope`, `no_token`, …) on
 *  `data.error` — distinct from a transport-level mutation failure below. */
const listedError: { current: string | null } = { current: null };
/** A transport-level mutation failure (`list.isError` / `list.error`). */
const mutationError: { current: unknown } = { current: null };
/** Every call the form made to `listSlackChannels.mutate`. */
const mutateCalls: { projectId: string; slackIntegrationId: string }[] = [];
/** Stable empty-array fallback for `listedChannels.current` — a fresh `[]`
 *  literal on every mocked render would loop the collection-sync effect. */
const NO_CHANNELS: { id: string; name: string }[] = [];

type Connection = {
  id: string;
  name: string;
  kind: "BOT" | "INCOMING_WEBHOOK";
  scopeType: "ORGANIZATION" | "PROJECT";
  scopeId: string;
  scopeName: string;
};
const BOT_CONNECTION: Connection = {
  id: "conn-bot",
  name: "Alerts bot",
  kind: "BOT",
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  scopeName: "Acme",
};
const WEBHOOK_CONNECTION: Connection = {
  id: "conn-hook",
  name: "Ops webhook",
  kind: "INCOMING_WEBHOOK",
  scopeType: "PROJECT",
  scopeId: "project-1",
  scopeName: "Project",
};
/** The connections the project can use, as `slackIntegration.list` answers. */
const connectionList: {
  current: Connection[] | undefined;
  canManage: boolean;
} = { current: [BOT_CONNECTION, WEBHOOK_CONNECTION], canManage: true };

const { keepDraftOnReturnMock } = vi.hoisted(() => ({ keepDraftOnReturnMock: vi.fn() }));

vi.mock("../behavior/sub-flow.ts", () => ({
  announceSubFlowDeparture: vi.fn(),
  keepDraftOnSubFlowReturn: keepDraftOnReturnMock,
}));

vi.mock("../../../behavior/automation-feedback.ts", () => ({
  useDescribeError:
    () =>
    ({ fallbackTitle }: { fallbackTitle?: string }) =>
      fallbackTitle ?? "Something went wrong",
}));

vi.mock("@langwatch/slack-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof SlackKit>()),
  slackApi: {
    slackIntegration: {
      list: {
        useQuery: () => ({
          data: connectionList.current
            ? {
                connections: connectionList.current,
                canManageProject: connectionList.canManage,
                canManageOrganization: false,
              }
            : undefined,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/automation-api.ts", () => ({
  api: {
    automation: {
      listSlackChannels: {
        useMutation: () => ({
          mutate: (
            args: { projectId: string; slackIntegrationId: string },
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

import type { SavedTriggerRow, SlackPreview } from "@langwatch/automation-contract";

import { AutomationHostProvider } from "../../../model/automation-host.ts";
import { fakeAutomationHost } from "../../../testing.tsx";
import { SLACK_BLOCK_KIT_TEMPLATES, templateOptionsFor } from "../../slack-templates/index.ts";
import slackClient, { type SlackSlice } from "../ui/sections/slack.client.tsx";

/** The host the Slack step hands connection creation to; rebuilt per connection test. */
let host = fakeAutomationHost();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <AutomationHostProvider value={host}>{children}</AutomationHostProvider>
  </ChakraProvider>
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
  const [slice, setSlice] = useState<SlackSlice>(initial ?? slackClient.initialSlice());
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
  slackIntegrationId: "conn-bot",
  deliveryMethod: "bot",
  channelId: "C0123",
  ...overrides,
});

const webhookSlice = (overrides: Partial<SlackSlice> = {}): SlackSlice => ({
  ...slackClient.initialSlice(),
  slackIntegrationId: "conn-hook",
  deliveryMethod: "webhook",
  ...overrides,
});

/** A saved Slack row as the read returns it, carrying the given action params. */
const slackRow = (actionParams: Record<string, unknown>): SavedTriggerRow => ({
  id: "tr_slack",
  name: "Slack automation",
  alertType: null,
  action: "SEND_SLACK_MESSAGE",
  actionParams,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  slackTemplate: null,
  slackTemplateType: "block_kit",
});

/** A row saved before connections, as the read returns it: no token of its own. */
const legacyBotRow = (): SavedTriggerRow =>
  slackRow({ slackDelivery: "bot", slackChannelId: "C0999" });

/** Opens the connection picker and chooses the named entry. */
async function chooseConnection({
  user,
  name,
}: {
  user: ReturnType<typeof userEvent.setup>;
  name: RegExp;
}) {
  await user.click(screen.getAllByRole("combobox")[0]!);
  await user.click(await screen.findByRole("option", { name }));
}

/** Stateful cadence host: the chooser writes through
 *  `setNotificationCadence` and the value flows back down as
 *  `notificationCadence` / `cadenceMode`, the way the draft store wires the
 *  real form owner. */
function CadenceHarness() {
  const [cadence, setCadence] = useState<ConfigFormCtx["notificationCadence"]>("immediate");
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

      expect(screen.getByRole("button", { name: /compact notice/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /digest: compact/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole("radio", { name: /in batches/i }));

      expect(screen.getByRole("button", { name: /digest: compact/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /compact notice/i })).not.toBeInTheDocument();
    });

    it("is not offered to a report, whose timing is its schedule", () => {
      renderForm({
        ctx: makeCtx({ sourceKind: "report", reportSourceKind: "traceQuery" }),
      });

      expect(screen.queryByText("How do you want to receive messages?")).not.toBeInTheDocument();
    });
  });

  describe("given a fresh block_kit draft", () => {
    describe("when the form first renders", () => {
      it("shows the guided layout picker", () => {
        renderForm();

        expect(screen.getByRole("button", { name: /compact notice/i })).toBeInTheDocument();
      });

      it("keeps the code editor hidden", () => {
        renderForm();

        expect(screen.queryByTestId("slack-code-editor")).not.toBeInTheDocument();
      });

      it("renders the synced preview", () => {
        renderForm();

        expect(screen.getByText(/preview in slack's block kit builder/i)).toBeInTheDocument();
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
        screen.getByRole("button", {
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
    const reportCtx = () => makeCtx({ sourceKind: "report", reportSourceKind: "traceQuery" });
    const layoutFor = (id: string) => SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.id === id)!;

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

      expect(await screen.findByTestId("slack-code-editor")).toBeInTheDocument();
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
      expect(screen.queryByRole("button", { name: /compact notice/i })).not.toBeInTheDocument();
    });
  });
});

describe("SlackConfigForm connection", () => {
  afterEach(() => {
    cleanup();
    connectionList.current = [BOT_CONNECTION, WEBHOOK_CONNECTION];
    connectionList.canManage = true;
    host = fakeAutomationHost();
    keepDraftOnReturnMock.mockReset();
  });

  describe("given the connection list has not landed yet", () => {
    it("waits instead of claiming there is none", () => {
      connectionList.current = undefined;
      renderForm();

      expect(screen.getByTestId("slack-state-loading")).toBeInTheDocument();
      expect(screen.queryByText(/no slack connections yet/i)).toBeNull();
    });
  });

  describe("given the project has no Slack connection", () => {
    /** @scenario "The author is guided to add a Slack connection" */
    it("points at the integration settings and asks for no token", () => {
      connectionList.current = [];
      renderForm();

      expect(screen.getByText(/no slack connections yet/i)).toBeInTheDocument();
      const manage = screen.getByRole("link", {
        name: /manage slack connections/i,
      });
      expect(manage).toHaveAttribute("href", "/settings/integrations");
      // A new tab, so the unsaved automation draft survives the visit.
      expect(manage).toHaveAttribute("target", "_blank");
      expect(screen.queryByPlaceholderText(/xoxb-/i)).not.toBeInTheDocument();
    });
  });

  describe("when the author picks connections", () => {
    /** @scenario "A bot connection asks for a channel, a webhook does not" */
    it("asks for a channel for a bot and none for a webhook", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      await chooseConnection({ user, name: /alerts bot/i });
      expect(await screen.findByPlaceholderText(/#alerts or c0123/i)).toBeInTheDocument();
      expect(onChangeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slackIntegrationId: "conn-bot",
          deliveryMethod: "bot",
        }),
      );

      await chooseConnection({ user, name: /ops webhook/i });
      expect(screen.queryByPlaceholderText(/#alerts or c0123/i)).not.toBeInTheDocument();
      expect(onChangeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slackIntegrationId: "conn-hook",
          deliveryMethod: "webhook",
        }),
      );
    });

    it("lists channels from the picked connection's workspace", async () => {
      renderForm({ initial: botSlice() });

      await waitFor(() =>
        expect(mutateCalls.at(-1)).toEqual({
          projectId: "project-1",
          slackIntegrationId: "conn-bot",
        }),
      );
    });
  });

  describe("when the author creates a connection from the Slack step", () => {
    const connectionHandover = () => {
      const handover = host.recording.slackConnectionHandovers.at(-1);
      if (!handover) throw new Error("expected the connection drawer to be opened");
      return handover;
    };

    /** @scenario "A connection created from the automation drawer is selected on return" */
    it("returns to the draft with the new connection selected", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      await chooseConnection({ user, name: /new slack connection/i });
      // Leaving is not returning: nothing keeps the draft until it ends.
      expect(keepDraftOnReturnMock).not.toHaveBeenCalled();
      const handover = connectionHandover();
      handover.created({
        connectionId: "conn-new",
        name: "Ops room",
        kind: "BOT",
      });
      handover.returned();

      expect(onChangeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slackIntegrationId: "conn-new",
          connectionName: "Ops room",
          deliveryMethod: "bot",
        }),
      );
      expect(keepDraftOnReturnMock).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Walking away from a new connection keeps the previous choice" */
    it("keeps the previous connection when closed without saving", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderForm({ initial: webhookSlice(), onChangeSpy });

      await chooseConnection({ user, name: /new slack connection/i });
      connectionHandover().returned();

      expect(onChangeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ slackIntegrationId: "conn-hook" }),
      );
    });

    it("is not offered to an author who cannot add connections", async () => {
      const user = userEvent.setup();
      connectionList.canManage = false;
      renderForm();

      await user.click(screen.getAllByRole("combobox")[0]!);

      expect(
        screen.queryByRole("option", { name: /new slack connection/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given an automation that still stores its own secret", () => {
    it("says so and leaves its settings untouched", () => {
      const slice = slackClient.fromTriggerRow(legacyBotRow());
      renderForm({ initial: slice });

      expect(screen.getByTestId("slack-legacy-secret")).toHaveTextContent(
        /uses a slack secret stored on this automation/i,
      );
      // The server moves the token the row stores into a connection on save.
      expect(slackClient.toActionParams(slice)).toEqual({
        slackDelivery: "bot",
        slackChannelId: "C0999",
      });
    });

    it("writes only the connection once one is picked", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderForm({
        initial: slackClient.fromTriggerRow(legacyBotRow()),
        onChangeSpy,
      });

      await chooseConnection({ user, name: /alerts bot/i });

      const picked = onChangeSpy.mock.lastCall?.[0] as SlackSlice;
      expect(slackClient.toActionParams(picked)).toEqual({
        slackIntegrationId: "conn-bot",
        slackDelivery: "bot",
        slackChannelId: "C0999",
      });
    });
  });
});

describe("SlackConfigForm channel picker", () => {
  afterEach(() => {
    cleanup();
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

    /** Puts a channel in the box in ONE input event (a paste), for tests not about typing: a
     *  single event has no gap for the combobox resync to drop a character in. */
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

    /** Types one character at a time, waiting for each prefix, for the test whose subject IS
     *  the per-keystroke search. `text` is literal; key descriptors do not survive the split. */
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

        expect(await screen.findByText(/more channels than we can list/i)).toBeInTheDocument();
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

        expect(screen.queryByText(/more channels than we can list/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/private channels aren't listed/i)).not.toBeInTheDocument();
      });
    });

    describe("given a saved automation whose channel id is already stored", () => {
      it("shows the channel name rather than the raw id", async () => {
        renderForm({ initial: botSlice({ channelId: "C003" }) });

        expect(await screen.findByDisplayValue("#release-signoff")).toBeInTheDocument();
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
      // A stable (if empty) array: a fresh `[]` would loop the sync effect.
      listedChannels.current = [];
      listedError.current = "no_token";
    });

    it("names the cause instead of showing nothing", async () => {
      renderForm({ initial: botSlice({ channelId: "" }) });

      expect(await screen.findByText(/this connection can.t list channels/i)).toBeInTheDocument();
    });
  });

  describe("when the author clicks Reload", () => {
    beforeEach(() => {
      listedChannels.current = [{ id: "C001", name: "alerts" }];
    });

    it("re-fires the channel listing request", async () => {
      const user = userEvent.setup();
      renderForm({ initial: botSlice({ channelId: "" }) });

      // The mount effect already issues one request for the connection.
      await screen.findByText("#alerts");
      const callsBeforeReload = mutateCalls.length;
      expect(callsBeforeReload).toBeGreaterThan(0);

      await user.click(screen.getByRole("button", { name: /reload/i }));

      expect(mutateCalls.length).toBeGreaterThan(callsBeforeReload);
    });
  });
});

describe("Slack client slice contract", () => {
  describe("given a bot connection", () => {
    describe("when the channel is set", () => {
      it("reports the config as complete", () => {
        expect(slackClient.isComplete(botSlice())).toBe(true);
      });

      it("writes the connection and channel, and no secret", () => {
        expect(slackClient.toActionParams(botSlice())).toEqual({
          slackIntegrationId: "conn-bot",
          slackDelivery: "bot",
          slackChannelId: "C0123",
        });
      });
    });

    describe("when the channel is not set", () => {
      /** @scenario "A bot automation is incomplete without a channel" */
      it("reports the config as incomplete", () => {
        expect(slackClient.isComplete(botSlice({ channelId: "" }))).toBe(false);
      });
    });

    it("previews the chart, table and banner blocks", () => {
      expect(slackClient.previewOptions?.({ slice: botSlice() })).toEqual({
        allowGatedBlocks: true,
      });
    });
  });

  describe("given a webhook connection", () => {
    it("is complete without a channel and writes only the connection", () => {
      expect(slackClient.isComplete(webhookSlice())).toBe(true);
      expect(slackClient.toActionParams(webhookSlice())).toEqual({
        slackIntegrationId: "conn-hook",
        slackDelivery: "webhook",
      });
    });

    /** @scenario "The richer templates are offered only for a bot connection" */
    it("drops the gated blocks from the preview", () => {
      expect(slackClient.previewOptions?.({ slice: webhookSlice() })).toEqual({
        allowGatedBlocks: false,
      });
    });
  });

  describe("given no connection yet", () => {
    it("reports the config as incomplete", () => {
      expect(slackClient.isComplete(slackClient.initialSlice())).toBe(false);
    });
  });

  describe("given a saved row with a connection", () => {
    it("reads the connection back and carries no legacy secret", () => {
      const slice = slackClient.fromTriggerRow(
        slackRow({
          slackIntegrationId: "conn-bot",
          slackDelivery: "bot",
          slackChannelId: "C0123",
        }),
      );

      expect(slice).toMatchObject({
        slackIntegrationId: "conn-bot",
        deliveryMethod: "bot",
        channelId: "C0123",
        legacyParams: null,
      });
    });
  });

  describe("given the connection's name is known", () => {
    it("summarises a bot as the connection and its channel", () => {
      expect(
        slackClient.summary(botSlice({ connectionName: "Alerts bot" }), {
          name: "Checkout alert",
        }),
      ).toBe("Slack → Alerts bot #C0123");
    });

    it("summarises a webhook as the connection alone", () => {
      expect(
        slackClient.summary(webhookSlice({ connectionName: "Ops webhook" }), {
          name: "Checkout alert",
        }),
      ).toBe("Slack → Ops webhook");
    });

    it("never writes the name into the action params", () => {
      expect(slackClient.toActionParams(botSlice({ connectionName: "Alerts bot" }))).toEqual({
        slackIntegrationId: "conn-bot",
        slackDelivery: "bot",
        slackChannelId: "C0123",
      });
    });
  });

  describe("given the connection's name is not known yet", () => {
    it("says Slack connection, with the channel for a bot", () => {
      expect(slackClient.summary(botSlice(), { name: "Checkout alert" })).toBe(
        "Slack connection #C0123",
      );
      expect(slackClient.summary(webhookSlice(), { name: "Checkout alert" })).toBe(
        "Slack connection",
      );
    });
  });
});

describe("SlackConfigForm connection name", () => {
  afterEach(() => {
    cleanup();
    connectionList.current = [BOT_CONNECTION, WEBHOOK_CONNECTION];
  });

  describe("when the author picks a connection", () => {
    it("carries its name on the slice", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      await chooseConnection({ user, name: /alerts bot/i });

      expect(onChangeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slackIntegrationId: "conn-bot",
          connectionName: "Alerts bot",
        }),
      );
    });
  });
});
