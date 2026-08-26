/**
 * @vitest-environment jsdom
 *
 * The webhook provider client had zero test coverage in the shared automation
 * provider implementation before this test was added.
 * webhook.ts unit suite covers the shared schema/sanitizer, but nothing
 * exercised this provider's client.tsx: URL validation surfaced in the
 * ConfigForm, the kept-header sentinel round-trip through fromTriggerRow /
 * toActionParams, and JSON-body default resolution). Mirrors the slack/email
 * provider test harness (see ../../slack/__tests__/client.integration.test.tsx
 * and ../../email/__tests__/client.integration.test.tsx).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SavedTriggerRow } from "@langwatch/automation-contract";
import {
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookActionParams,
} from "@langwatch/automation-contract";
import {
  DEFAULT_ALERT_WEBHOOK_BODY_TEMPLATE,
  DEFAULT_REPORT_WEBHOOK_BODY_TEMPLATE,
  DEFAULT_WEBHOOK_BODY_TEMPLATE,
} from "@langwatch/automation-contract";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "@langwatch/automation-web";

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
/** The Liquid editor is Monaco-bound and cannot mount in jsdom. Stub just that
 *  one export as a textarea carrying its `value`, so a test can read back the
 *  template the editor was seeded with. Everything else in the module stays
 *  real (FieldHeader is exercised as-is). */
vi.mock("~/features/automations/editors/templateAuthoring", async (original) => {
  const actual =
    await original<typeof import("~/features/automations/editors/templateAuthoring")>();
  return {
    ...actual,
    LiquidEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
  };
});

import type { WebhookPreview } from "@langwatch/automation-contract";
import webhookClient, { type WebhookSlice } from "../client";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeCtx(
  overrides: Partial<ConfigFormCtx<WebhookPreview>> = {},
): ConfigFormCtx<WebhookPreview> {
  return {
    projectId: "project-1",
    organizationId: "org-1",
    teamSlug: "team-1",
    variables: [],
    example: {},
    preview: undefined,
    previewLoading: false,
    cadenceMode: "immediate",
    notificationCadence: "immediate",
    setNotificationCadence: vi.fn(),
    hasEvaluationFilter: false,
    sourceKind: "trace",
    ...overrides,
  };
}

/** `onChangeSpy` mirrors the Slack suite's harness: it sees every slice the
 *  form emits, so a test can assert on what a save would serialise. */
function Harness({
  ctx,
  initial,
  onChangeSpy,
}: {
  ctx: ConfigFormCtx<WebhookPreview>;
  initial?: WebhookSlice;
  onChangeSpy?: (next: WebhookSlice) => void;
}) {
  const [slice, setSlice] = useState<WebhookSlice>(
    initial ?? webhookClient.initialSlice(),
  );
  const Form = webhookClient.ConfigForm;
  return (
    <Form
      slice={slice}
      ctx={ctx}
      onChange={(next) => {
        setSlice(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

const renderForm = ({
  ctx = makeCtx(),
  initial,
  onChangeSpy,
}: {
  ctx?: ConfigFormCtx<WebhookPreview>;
  initial?: WebhookSlice;
  onChangeSpy?: (next: WebhookSlice) => void;
} = {}) =>
  render(<Harness ctx={ctx} initial={initial} onChangeSpy={onChangeSpy} />, {
    wrapper: Wrapper,
  });

function savedRowWith(actionParams: Partial<WebhookActionParams>): SavedTriggerRow {
  return { actionParams } as SavedTriggerRow;
}

describe("WebhookConfigForm URL validation", () => {
  afterEach(() => cleanup());

  describe("given a fresh webhook draft", () => {
    it("shows no error before anything is typed", () => {
      renderForm();

      expect(
        screen.queryByText(/the webhook url must use https/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the author types a non-https URL", () => {
    it("shows the https-only error", () => {
      renderForm();

      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/hooks/langwatch"),
        { target: { value: "http://example.com/hooks" } },
      );

      expect(screen.getByText(/the webhook url must use https/i)).toBeInTheDocument();
    });
  });

  describe("when the author types a non-default port", () => {
    it("shows the default-port-only error", () => {
      renderForm();

      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/hooks/langwatch"),
        { target: { value: "https://example.com:8443/hooks" } },
      );

      expect(screen.getByText(/only the default https port/i)).toBeInTheDocument();
    });
  });

  describe("when the author types a valid https URL", () => {
    it("clears the error", () => {
      renderForm();

      const input = screen.getByPlaceholderText("https://example.com/hooks/langwatch");
      fireEvent.change(input, { target: { value: "http://bad" } });
      expect(screen.getByText(/must use https/i)).toBeInTheDocument();

      fireEvent.change(input, {
        target: { value: "https://example.com/hooks/langwatch" },
      });

      expect(
        screen.queryByText(/the webhook url must use https/i),
      ).not.toBeInTheDocument();
    });
  });
});

describe("webhookClient kept-header sentinel round-trip", () => {
  describe("given a saved trigger row with a kept header value", () => {
    it("marks the header row as kept, dropping the sentinel from its value", () => {
      const slice = webhookClient.fromTriggerRow(
        savedRowWith({
          url: "https://example.com/hooks",
          method: "POST",
          headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
          bodyTemplate: null,
        }),
      );

      expect(slice.headers).toHaveLength(1);
      expect(slice.headers[0]).toMatchObject({
        name: "Authorization",
        kept: true,
      });
    });

    it("re-sends the kept sentinel on toActionParams without further edits", () => {
      const slice = webhookClient.fromTriggerRow(
        savedRowWith({
          url: "https://example.com/hooks",
          method: "POST",
          headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
          bodyTemplate: null,
        }),
      );

      const params = webhookClient.toActionParams(slice) as WebhookActionParams;

      expect(params.headers.Authorization).toBe(WEBHOOK_HEADER_VALUE_KEPT);
    });
  });

  describe("given a saved trigger row with a plain header value", () => {
    it("does not mark the row as kept", () => {
      const slice = webhookClient.fromTriggerRow(
        savedRowWith({
          url: "https://example.com/hooks",
          method: "POST",
          headers: { "X-Custom": "plain-value" },
          bodyTemplate: null,
        }),
      );

      expect(slice.headers[0]).toMatchObject({
        name: "X-Custom",
        value: "plain-value",
        kept: false,
      });
    });
  });

  describe("when the author edits a kept header's value", () => {
    it("clears the kept flag so the new value is sent on save", () => {
      renderForm({
        initial: webhookClient.fromTriggerRow(
          savedRowWith({
            url: "https://example.com/hooks",
            method: "POST",
            headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
            bodyTemplate: null,
          }),
        ),
      });

      const valueInput = screen.getByPlaceholderText("•••••• (saved)");
      fireEvent.change(valueInput, { target: { value: "Bearer new-token" } });

      expect(screen.queryByPlaceholderText("•••••• (saved)")).not.toBeInTheDocument();
    });
  });
});

function signingSecretInput() {
  return screen.getByTestId("webhook-signing-secret");
}

/** A saved row whose only secret is the signing one, so the masked placeholder
 *  it renders cannot be confused with a kept header row's. */
const savedSignedRow = savedRowWith({
  url: "https://example.com/hooks",
  method: "POST",
  headers: {},
  bodyTemplate: null,
  signingSecret: WEBHOOK_HEADER_VALUE_KEPT,
});

describe("webhookClient signing secret", () => {
  afterEach(() => cleanup());

  describe("given a fresh webhook draft", () => {
    it("renders an empty masked signing secret field", () => {
      renderForm();

      expect(signingSecretInput()).toHaveValue("");
      expect(signingSecretInput()).toHaveAttribute("type", "password");
    });

    it("resolves signingSecret to null on toActionParams, leaving deliveries unsigned", () => {
      const params = webhookClient.toActionParams(
        webhookClient.initialSlice(),
      ) as WebhookActionParams;

      expect(params.signingSecret).toBeNull();
    });
  });

  describe("when the author types a signing secret", () => {
    it("sends the typed value on toActionParams", () => {
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      fireEvent.change(signingSecretInput(), {
        target: { value: "whsec_typed" },
      });

      expect(signingSecretInput()).toHaveValue("whsec_typed");
      const params = webhookClient.toActionParams(
        onChangeSpy.mock.calls.at(-1)![0],
      ) as WebhookActionParams;
      expect(params.signingSecret).toBe("whsec_typed");
    });
  });

  describe("given a saved trigger row with a kept signing secret", () => {
    it("shows a secret is stored without exposing the sentinel", () => {
      renderForm({ initial: webhookClient.fromTriggerRow(savedSignedRow) });

      expect(signingSecretInput()).toHaveValue("");
      expect(signingSecretInput()).toHaveAttribute("placeholder", "•••••• (saved)");
      expect(
        screen.queryByDisplayValue(WEBHOOK_HEADER_VALUE_KEPT),
      ).not.toBeInTheDocument();
    });

    it("re-sends the kept sentinel on toActionParams without further edits", () => {
      const params = webhookClient.toActionParams(
        webhookClient.fromTriggerRow(savedSignedRow),
      ) as WebhookActionParams;

      expect(params.signingSecret).toBe(WEBHOOK_HEADER_VALUE_KEPT);
    });
  });

  describe("when the author removes a stored signing secret", () => {
    it("sends null on toActionParams so deliveries go unsigned again", () => {
      const onChangeSpy = vi.fn();
      renderForm({
        initial: webhookClient.fromTriggerRow(savedSignedRow),
        onChangeSpy,
      });

      fireEvent.click(screen.getByLabelText("Remove signing secret"));

      const params = webhookClient.toActionParams(
        onChangeSpy.mock.calls.at(-1)![0],
      ) as WebhookActionParams;
      expect(params.signingSecret).toBeNull();
      expect(screen.queryByLabelText("Remove signing secret")).not.toBeInTheDocument();
    });
  });

  describe("when the author clears a typed signing secret", () => {
    it("sends null on toActionParams so deliveries go unsigned again", () => {
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      fireEvent.change(signingSecretInput(), {
        target: { value: "whsec_typed" },
      });
      fireEvent.change(signingSecretInput(), { target: { value: "" } });

      const params = webhookClient.toActionParams(
        onChangeSpy.mock.calls.at(-1)![0],
      ) as WebhookActionParams;
      expect(params.signingSecret).toBeNull();
    });
  });
});

function bodyTextbox() {
  return within(screen.getByTestId("webhook-body-editor")).getByRole("textbox");
}

describe("webhookClient JSON-body default resolution", () => {
  afterEach(() => cleanup());

  describe("given a trace-sourced draft with no custom body", () => {
    it("seeds the editor with the trace default body", () => {
      renderForm({ ctx: makeCtx({ sourceKind: "trace" }) });

      expect(bodyTextbox()).toHaveValue(DEFAULT_WEBHOOK_BODY_TEMPLATE);
    });
  });

  describe("given a graph-alert-sourced draft with no custom body", () => {
    it("seeds the editor with the alert default body", () => {
      renderForm({ ctx: makeCtx({ sourceKind: "graphAlert" }) });

      expect(bodyTextbox()).toHaveValue(DEFAULT_ALERT_WEBHOOK_BODY_TEMPLATE);
    });
  });

  describe("given a report-sourced draft with no custom body", () => {
    it("seeds the editor with the report default body", () => {
      renderForm({ ctx: makeCtx({ sourceKind: "report" }) });

      expect(bodyTextbox()).toHaveValue(DEFAULT_REPORT_WEBHOOK_BODY_TEMPLATE);
    });
  });

  describe("given a draft whose body still uses the default", () => {
    it("resolves bodyTemplate to null on toActionParams, not the rendered default", () => {
      const slice = webhookClient.initialSlice();

      const params = webhookClient.toActionParams(slice) as WebhookActionParams;

      expect(params.bodyTemplate).toBeNull();
    });
  });

  describe("given a draft with a custom body already typed", () => {
    it("renders the typed template instead of the default", () => {
      renderForm({
        initial: {
          ...webhookClient.initialSlice(),
          template: { value: '{"custom": true}', usingDefault: false },
        },
      });

      expect(bodyTextbox()).toHaveValue('{"custom": true}');
    });

    it("resolves bodyTemplate to the typed template on toActionParams", () => {
      const slice: WebhookSlice = {
        ...webhookClient.initialSlice(),
        template: { value: '{"custom": true}', usingDefault: false },
      };

      const params = webhookClient.toActionParams(slice) as WebhookActionParams;

      expect(params.bodyTemplate).toBe('{"custom": true}');
    });
  });
});
