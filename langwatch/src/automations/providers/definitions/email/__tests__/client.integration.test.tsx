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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "~/automations/providers/types";
import {
  ALERT_TRIGGER_DEFAULTS,
  REPORT_TRIGGER_DEFAULTS,
  TRACE_TRIGGER_DEFAULTS,
} from "~/shared/templating/defaults";

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
/** The Liquid editor is Monaco-bound and cannot mount in jsdom. Stub just that
 *  one export as a textarea carrying its `value`, so a test can read back the
 *  template the editor was seeded with — the template an author's first
 *  keystroke would persist. Everything else in the module stays real. */
vi.mock(
  "~/features/automations/editors/templateAuthoring",
  async (original) => {
    const actual =
      await original<
        typeof import("~/features/automations/editors/templateAuthoring")
      >();
    return {
      ...actual,
      LiquidEditor: ({ value }: { value: string }) => (
        <textarea readOnly value={value} />
      ),
    };
  },
);
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

/**
 * The editor is seeded with the template dispatch will really render — the
 * author's first keystroke persists whatever it was showing. Seed the wrong
 * kind and a report author saves trace copy (`{% for m in matches %}`) that
 * renders empty against the report context, next to a preview showing something
 * else entirely.
 */
describe("EmailConfigForm default wording", () => {
  afterEach(() => cleanup());

  function openedEditors(ctx: ConfigFormCtx<EmailPreview>) {
    renderForm(ctx);
    fireEvent.click(screen.getByRole("button", { name: /customize wording/i }));
    return {
      subject: within(screen.getByTestId("email-subject-editor")).getByRole(
        "textbox",
      ),
      body: within(screen.getByTestId("email-body-editor")).getByRole(
        "textbox",
      ),
    };
  }

  describe("given a report draft", () => {
    it("seeds the report subject and body, not the trace ones", () => {
      const { subject, body } = openedEditors(
        makeCtx({ sourceKind: "report" }),
      );

      expect(subject).toHaveValue(REPORT_TRIGGER_DEFAULTS.emailSubject);
      expect(body).toHaveValue(REPORT_TRIGGER_DEFAULTS.emailBody);
    });

    it("drops the cadence switch — a report runs on its own schedule", () => {
      renderForm(makeCtx({ sourceKind: "report" }));

      expect(screen.queryByText(/cadence/i)).not.toBeInTheDocument();
    });
  });

  describe("given a graph-alert draft", () => {
    it("seeds the alert subject and body", () => {
      const { subject, body } = openedEditors(
        makeCtx({ sourceKind: "graphAlert" }),
      );

      expect(subject).toHaveValue(ALERT_TRIGGER_DEFAULTS.emailSubject);
      expect(body).toHaveValue(ALERT_TRIGGER_DEFAULTS.emailBody);
    });
  });

  describe("given a trace draft", () => {
    it("seeds the trace subject and body", () => {
      const { subject, body } = openedEditors(makeCtx());

      expect(subject).toHaveValue(TRACE_TRIGGER_DEFAULTS.emailSubject);
      expect(body).toHaveValue(TRACE_TRIGGER_DEFAULTS.emailBody);
    });

    it("renders no cadence switch — timing moved to the drawer's Cadence section", () => {
      // The digest/immediate choice lives in CadenceSection now (drawer UX
      // rework); the config form owns only recipients and wording. The
      // trace-can-digest behavior is covered by
      // CadenceSection.integration.test.tsx.
      renderForm(makeCtx());

      expect(screen.queryByText(/cadence/i)).not.toBeInTheDocument();
    });
  });
});
