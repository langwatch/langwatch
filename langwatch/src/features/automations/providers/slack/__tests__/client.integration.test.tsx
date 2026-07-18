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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "~/features/automations/providers/types";

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
vi.mock("~/components/ui/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    automation: {
      getTriggers: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      listSlackChannels: {
        useMutation: () => ({
          mutate: vi.fn(),
          data: undefined,
          isPending: false,
        }),
      },
    },
  },
}));

import slackClient, { type SlackSlice } from "../client";
import { SLACK_BOT_TOKEN_KEPT, type SlackPreview } from "../shared";
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

describe("SlackConfigForm authoring tiers", () => {
  afterEach(() => cleanup());

  describe("given a fresh block_kit draft", () => {
    describe("when the form first renders", () => {
      it("shows the guided template gallery", () => {
        renderForm();

        expect(
          screen.getByRole("button", { name: /use compact alert template/i }),
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
        screen.getByRole("button", {
          name: new RegExp(`use ${firstOption!.displayName} template`, "i"),
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
    it("reveals the plain text editor and drops the gallery", () => {
      renderForm();

      fireEvent.click(
        screen.getByRole("button", {
          name: /write the message as plain text/i,
        }),
      );

      expect(screen.getByTestId("slack-text-editor")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use compact alert template/i }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("SlackConfigForm delivery method", () => {
  afterEach(() => cleanup());

  describe("given a fresh draft (a new automation)", () => {
    it("is bot-only — channel + token fields, no webhook option", () => {
      renderForm();

      expect(
        screen.getByPlaceholderText(/#alerts or c0123/i),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/xoxb-/i)).toBeInTheDocument();
      // A new automation cannot pick a webhook — no field, no connection toggle.
      expect(
        screen.queryByPlaceholderText(/hooks\.slack\.com/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("radio", { name: /incoming webhook/i }),
      ).not.toBeInTheDocument();
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
      renderForm({ initial: legacySlice() });

      await user.click(screen.getByRole("radio", { name: /slack app/i }));

      expect(await screen.findByPlaceholderText(/xoxb-/i)).toBeInTheDocument();
    });
  });

  describe("given a bot draft whose token is already stored", () => {
    it("offers to keep the saved token without retyping", () => {
      renderForm({ initial: botSlice({ botTokenAlreadySet: true }) });

      expect(
        screen.getByPlaceholderText(/unchanged, leave blank to keep/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /replace token/i }),
      ).toBeInTheDocument();
    });

    it("lets the author select a template that needs a Slack app", () => {
      renderForm({ initial: botSlice({ botTokenAlreadySet: true }) });

      expect(
        screen.getByRole("button", {
          name: /use eval failure banner template/i,
        }),
      ).toBeEnabled();
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

    describe("when the channel is set but no token exists yet", () => {
      it("reports the config as incomplete", () => {
        expect(
          slackClient.isComplete(botSlice({ botTokenAlreadySet: false })),
        ).toBe(false);
      });
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
