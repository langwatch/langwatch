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
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "~/automations/providers/types";

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
    },
  },
}));

import slackClient, { type SlackSlice } from "../client";
import type { SlackPreview } from "../shared";
import { templateOptionsFor } from "../templates/registry";

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
  onChangeSpy,
}: {
  ctx: ConfigFormCtx<SlackPreview>;
  onChangeSpy?: (next: SlackSlice) => void;
}) {
  const [slice, setSlice] = useState<SlackSlice>(slackClient.initialSlice());
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
    onChangeSpy?: (next: SlackSlice) => void;
  } = {},
) =>
  render(<Harness ctx={props.ctx ?? makeCtx()} onChangeSpy={props.onChangeSpy} />, {
    wrapper: Wrapper,
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

  describe("when the author opens edit as code", () => {
    it("reveals the raw Block Kit editor", () => {
      renderForm();

      fireEvent.click(screen.getByRole("button", { name: /edit as code/i }));

      expect(screen.getByTestId("slack-code-editor")).toBeInTheDocument();
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
