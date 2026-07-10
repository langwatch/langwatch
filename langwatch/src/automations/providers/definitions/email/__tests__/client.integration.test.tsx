/**
 * @vitest-environment jsdom
 *
 * The email notification config keeps the default surface a preview only —
 * the ready-made subject and body sit behind a "Customize wording" opt-in so
 * an author who is happy with the default never faces an editor. These tests
 * pin that the editors stay hidden until the tier is opened. Monaco cannot
 * mount in jsdom, so it is stubbed; the editors are asserted through their
 * wrapper test ids.
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
    team: {
      getTeamWithMembers: {
        useQuery: () => ({ data: { members: [] }, isLoading: false }),
      },
    },
  },
}));

import emailClient, { type EmailSlice } from "../client";
import type { EmailPreview } from "../shared";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeCtx(
  overrides: Partial<ConfigFormCtx<EmailPreview>> = {},
): ConfigFormCtx<EmailPreview> {
  return {
    projectId: "project-1",
    organizationId: "org-1",
    teamSlug: "team-1",
    variables: [],
    example: {},
    preview: {
      channel: "email",
      usedDefault: true,
      missingVariables: [],
      errors: [],
      subject: "A trace matched",
      html: "<p>hello</p>",
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

function Harness({ ctx }: { ctx: ConfigFormCtx<EmailPreview> }) {
  const [slice, setSlice] = useState<EmailSlice>(emailClient.initialSlice());
  const Form = emailClient.ConfigForm;
  return <Form slice={slice} ctx={ctx} onChange={setSlice} />;
}

const renderForm = (ctx: ConfigFormCtx<EmailPreview> = makeCtx()) =>
  render(<Harness ctx={ctx} />, { wrapper: Wrapper });

describe("EmailConfigForm authoring tiers", () => {
  afterEach(() => cleanup());

  describe("given a fresh email draft", () => {
    describe("when the form first renders", () => {
      it("keeps the subject and body editors hidden", () => {
        renderForm();

        expect(
          screen.queryByTestId("email-subject-editor"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("email-body-editor"),
        ).not.toBeInTheDocument();
      });

      it("offers a customize wording expander", () => {
        renderForm();

        expect(
          screen.getByRole("button", { name: /customize wording/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("when the author opens customize wording", () => {
    it("reveals the subject and body editors", () => {
      renderForm();

      fireEvent.click(
        screen.getByRole("button", { name: /customize wording/i }),
      );

      expect(screen.getByTestId("email-subject-editor")).toBeInTheDocument();
      expect(screen.getByTestId("email-body-editor")).toBeInTheDocument();
    });
  });
});
