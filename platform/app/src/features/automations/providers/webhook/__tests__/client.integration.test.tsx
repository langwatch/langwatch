/**
 * @vitest-environment jsdom
 *
 * The webhook provider client had zero test coverage (packages/automations'
 * webhook.ts unit suite covers the shared schema/sanitizer, but nothing
 * exercised this provider's client.tsx: URL validation surfaced in the
 * ConfigForm, the kept-header sentinel round-trip through fromTriggerRow /
 * toActionParams, and JSON-body default resolution). Mirrors the slack/email
 * provider test harness (see ../../slack/__tests__/client.integration.test.tsx
 * and ../../email/__tests__/client.integration.test.tsx).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SavedTriggerRow } from "@langwatch/automations/providers/types";
import {
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookActionParams,
} from "@langwatch/automations/providers/webhook";
import {
  DEFAULT_ALERT_WEBHOOK_BODY_TEMPLATE,
  DEFAULT_REPORT_WEBHOOK_BODY_TEMPLATE,
  DEFAULT_WEBHOOK_BODY_TEMPLATE,
} from "@langwatch/automations/templating/defaults";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "~/features/automations/providers/types";

vi.mock("@monaco-editor/react", () => ({ default: () => null }));
/** The Liquid editor is Monaco-bound and cannot mount in jsdom. Stub just that
 *  one export as a textarea carrying its `value`, so a test can read back the
 *  template the editor was seeded with. Everything else in the module stays
 *  real (FieldHeader is exercised as-is). */
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

import type { WebhookPreview } from "@langwatch/automations/providers/webhook";
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

function savedRowWith(
  actionParams: Partial<WebhookActionParams>,
): SavedTriggerRow {
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
    /** @scenario "Only https URLs are accepted" */
    it("shows the https-only error", () => {
      renderForm();

      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/hooks/langwatch"),
        { target: { value: "http://example.com/hooks" } },
      );

      expect(
        screen.getByText(/the webhook url must use https/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the author types a non-default port", () => {
    /** @scenario "Non-standard ports are rejected" */
    it("shows the default-port-only error", () => {
      renderForm();

      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/hooks/langwatch"),
        { target: { value: "https://example.com:8443/hooks" } },
      );

      expect(
        screen.getByText(/only the default https port/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the author types a valid https URL", () => {
    it("clears the error", () => {
      renderForm();

      const input = screen.getByPlaceholderText(
        "https://example.com/hooks/langwatch",
      );
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

describe("WebhookConfigForm setup fields", () => {
  afterEach(() => cleanup());

  describe("given a fresh webhook draft", () => {
    /** @scenario "A webhook automation configures a URL, method, headers, and a body" */
    it("offers the destination, method, headers and body a delivery needs", async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/hooks/langwatch"),
        { target: { value: "https://example.com/hooks/langwatch" } },
      );
      await user.click(screen.getByText("PUT"));
      fireEvent.click(screen.getByRole("button", { name: /add header/i }));
      fireEvent.change(screen.getByPlaceholderText("Authorization"), {
        target: { value: "Authorization" },
      });
      fireEvent.change(screen.getByPlaceholderText("Bearer …"), {
        target: { value: "Bearer token" },
      });

      const params = webhookClient.toActionParams(
        onChangeSpy.mock.calls.at(-1)![0],
      ) as WebhookActionParams;
      expect(params).toMatchObject({
        url: "https://example.com/hooks/langwatch",
        method: "PUT",
        headers: { Authorization: "Bearer token" },
      });
      // The body is authored as a Liquid template, seeded with the framework
      // default; leaving it untouched stores null, which is what makes each
      // fire render that default rather than a frozen copy of it.
      expect(bodyTextbox()).toHaveValue(DEFAULT_WEBHOOK_BODY_TEMPLATE);
      expect(params.bodyTemplate).toBeNull();
    });
  });
});

describe("WebhookConfigForm test-fire outcome", () => {
  afterEach(() => cleanup());

  describe("when the last test fire succeeded", () => {
    /** @scenario "A successful test shows the real status code inline" */
    it("shows the endpoint's status next to the test button", () => {
      renderForm({
        ctx: makeCtx({
          lastTestAttempt: {
            at: Date.now(),
            channel: "webhook",
            status: "success",
            httpStatus: 202,
          },
        }),
      });

      expect(screen.getByTestId("webhook-test-result")).toHaveTextContent(
        "Delivered — HTTP 202",
      );
    });
  });

  describe("when the last test fire failed", () => {
    /** @scenario "A failing test shows the error inline next to the test button" */
    it("names what went wrong and the status or transport failure", () => {
      renderForm({
        ctx: makeCtx({
          lastTestAttempt: {
            at: Date.now(),
            channel: "webhook",
            status: "failure",
            errorTitle: "Test request failed",
            errorDetail: 'received HTTP 500: {"error":"boom"}',
          },
        }),
      });

      const result = screen.getByTestId("webhook-test-result");
      expect(result).toHaveTextContent("Test request failed");
      expect(result).toHaveTextContent("received HTTP 500");
    });
  });

  describe("when the last test fire was on another channel", () => {
    it("shows nothing, so a Slack outcome never reads as this endpoint's", () => {
      renderForm({
        ctx: makeCtx({
          lastTestAttempt: {
            at: Date.now(),
            channel: "slack",
            status: "success",
          },
        }),
      });

      expect(
        screen.queryByTestId("webhook-test-result"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("webhookClient kept-header sentinel round-trip", () => {
  describe("given a saved trigger row with a kept header value", () => {
    /** @scenario "Saved header values never return to the browser" */
    it("shows the header name behind a masked value and re-sends the sentinel untouched", () => {
      const slice = webhookClient.fromTriggerRow(
        savedRowWith({
          url: "https://example.com/hooks",
          method: "POST",
          headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
          bodyTemplate: null,
        }),
      );
      renderForm({ initial: slice });

      // The name is on screen; the saved value is nowhere on it.
      expect(screen.getByPlaceholderText("Authorization")).toHaveValue(
        "Authorization",
      );
      expect(screen.getByPlaceholderText("•••••• (saved)")).toHaveValue("");
      expect(
        screen.queryByDisplayValue(WEBHOOK_HEADER_VALUE_KEPT),
      ).not.toBeInTheDocument();

      // Saving with the value left untouched sends the sentinel, which is what
      // makes the server keep the stored secret instead of clearing it.
      const params = webhookClient.toActionParams(slice) as WebhookActionParams;
      expect(params.headers.Authorization).toBe(WEBHOOK_HEADER_VALUE_KEPT);
    });

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

      expect(
        screen.queryByPlaceholderText("•••••• (saved)"),
      ).not.toBeInTheDocument();
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
      expect(signingSecretInput()).toHaveAttribute(
        "placeholder",
        "•••••• (saved)",
      );
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
      expect(
        screen.queryByLabelText("Remove signing secret"),
      ).not.toBeInTheDocument();
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

describe("webhookClient Content-Type", () => {
  afterEach(() => cleanup());

  const contentTypeInput = () => screen.getByTestId("webhook-content-type");

  describe("given a fresh webhook draft", () => {
    /** @scenario "Content-Type is a fixed header row that defaults to JSON" */
    it("leads the headers with a fixed Content-Type row set to JSON", () => {
      renderForm();

      expect(contentTypeInput()).toHaveValue("application/json");
      // The name cell is fixed — the row is always there and cannot be
      // removed, so the delivery always announces something.
      expect(screen.getByDisplayValue("Content-Type")).toBeDisabled();

      const params = webhookClient.toActionParams(
        webhookClient.initialSlice(),
      ) as WebhookActionParams;
      expect(params.contentType).toBe("application/json");
    });

    it("rejects a value that is not a media type, where it is typed", () => {
      renderForm();

      fireEvent.change(contentTypeInput(), { target: { value: "banana" } });

      expect(screen.getByText(/media type/i)).toBeInTheDocument();
    });
  });

  describe("when the author declares a non-JSON Content-Type", () => {
    /** @scenario "The editor and preview follow the declared Content-Type" */
    it("sends it on toActionParams and stops treating the body as JSON", () => {
      const onChangeSpy = vi.fn();
      renderForm({ onChangeSpy });

      // JSON first: the editor is seeded with the framework envelope.
      expect(bodyTextbox()).toHaveValue(DEFAULT_WEBHOOK_BODY_TEMPLATE);

      fireEvent.change(contentTypeInput(), {
        target: { value: "text/plain" },
      });

      const params = webhookClient.toActionParams(
        onChangeSpy.mock.calls.at(-1)![0],
      ) as WebhookActionParams;
      expect(params.contentType).toBe("text/plain");
      // A non-JSON body has no framework envelope to seed or reset to.
      expect(bodyTextbox()).toHaveValue("");
      expect(screen.queryByText("Using default")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /reset to default/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a saved trigger row", () => {
    it("reads the stored Content-Type back", () => {
      const slice = webhookClient.fromTriggerRow(
        savedRowWith({
          url: "https://example.com/hooks",
          contentType: "text/plain; charset=utf-8",
          bodyTemplate: "hello",
        }),
      );

      expect(slice.contentType).toBe("text/plain; charset=utf-8");
    });

    it("reads a row saved before the field existed as JSON", () => {
      const slice = webhookClient.fromTriggerRow(
        savedRowWith({ url: "https://example.com/hooks", bodyTemplate: null }),
      );

      expect(slice.contentType).toBe("application/json");
    });
  });
});

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
