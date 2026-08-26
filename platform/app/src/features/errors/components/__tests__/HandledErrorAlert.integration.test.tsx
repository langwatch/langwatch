/**
 * @vitest-environment jsdom
 *
 * The alert and its footer are where the module's security-relevant decisions
 * actually reach a person: which copy wins, whether server tips are shown, and
 * what `docsUrl` turns into. None of it was covered — the logic tests assert
 * that `showErrorToast` *sets* `meta.docsUrl`, and nothing asserted anyone
 * reads it back out or that a hostile one is refused.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  markAsHandledByLicenseHandler,
  markAsHandledByLiteMemberHandler,
  markAsHandledByMissingModelHandler,
  markAsHandledByProviderDisabledHandler,
} from "~/utils/trpcError";

import { HandledErrorAlert } from "../HandledErrorAlert";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A tRPC error envelope carrying a handled payload, as the boundary sends it. */
function handledError({
  code,
  httpStatus = 400,
  ...rest
}: {
  code: string;
  httpStatus?: number;
  fault?: string;
  tips?: string[];
  docsUrl?: string;
  traceId?: string;
  meta?: Record<string, unknown>;
}) {
  return { message: code, data: { error: { code, httpStatus, ...rest } } };
}

/**
 * The canonical envelope the GO gateway writes (pkg/herr WriteHTTP →
 * ErrorResponse): the whole failure nested under `error`, lower_snake_case
 * throughout. Distinct from the tRPC helper above, and the distinction is the
 * point — the gateway's fields are `docs_url` / `trace_id`, and reading them
 * under the camelCase names is the bug `fromCanonicalEnvelope` was added to
 * fix. A fixture in the tRPC shape cannot exercise that path at all.
 */
function gatewayError({
  code,
  message,
  meta,
  tips,
  docsUrl,
  traceId,
  fault = "customer",
}: {
  code: string;
  message?: string;
  meta?: Record<string, unknown>;
  tips?: string[];
  docsUrl?: string;
  traceId?: string;
  fault?: string;
}) {
  return {
    error: {
      type: code,
      code,
      message: message ?? code,
      ...(meta ? { meta } : {}),
      ...(tips ? { tips } : {}),
      ...(docsUrl ? { docs_url: docsUrl } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
      fault,
    },
  };
}

const renderAlert = (props: Parameters<typeof HandledErrorAlert>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <HandledErrorAlert {...props} />
    </ChakraProvider>,
  );

describe("<HandledErrorAlert />", () => {
  /**
   * The gateway's provider-setup failures, rendered from the envelope the Go
   * service actually writes: the nested `{error:{...}}` shape with
   * lower_snake_case fields, so these exercise `fromCanonicalEnvelope` rather
   * than the tRPC reading.
   *
   * The tips are the four in
   * `services/aigateway/domain/remediation.go#providerCredentialTips["vertex"]`,
   * which is what the server sends and what `TestRemediate_Vertex…` pins on the
   * Go side. Four, not more: `capTips` caps the server at the client's
   * MAX_TIPS, so a fifth would be written only to be discarded.
   *
   * These failures used to reach customers as `provider_timeout`: "The model
   * provider timed out. Try again in a moment." for a pasted credential that
   * would never work. Nothing about which provider, which model, what a
   * correct value looks like, or where it is documented.
   */
  describe("given a gateway provider-setup failure", () => {
    const vertexCredentialEnvelope = {
      code: "provider_credential_invalid",
      message:
        "The credentials configured for this model provider were not accepted. Check the provider's credentials in your model provider settings.",
      fault: "customer",
      docsUrl: "https://docs.langwatch.ai/ai-gateway/providers/vertex",
      traceId: "827cbb32e654bf7700000000827cbb32",
      meta: { provider: "vertex", model: "gemini-2.5-flash" },
      tips: [
        "Vertex AI authenticates with a Google Cloud service-account JSON document, not an API key — paste the whole file contents into the provider's credentials field",
        'The document must be valid JSON with a top-level "type" of "service_account"; a file PATH, or the OAuth client JSON that has no "type", is rejected here',
        "The service account needs the Vertex AI User role on the project named by Vertex Project ID",
        'Vertex Location may be a region such as us-central1, or "global" — both are valid, and neither one causes this error',
      ],
    };

    /** @scenario "A provider-setup failure tells the customer how to fix it" */
    it("names the provider from meta instead of saying 'this provider'", () => {
      renderAlert({ error: gatewayError(vertexCredentialEnvelope) });

      expect(
        screen.getByText(/Google Vertex AI credentials saved for this project/),
      ).toBeInTheDocument();
    });

    /**
     * The client caps the list at `MAX_TIPS` (4) — "more than this is a
     * document, not remediation" — so the server orders the advice with the
     * provider-specific, actionable lines first and truncates to the same
     * number before sending. This asserts the surviving tips are the ones
     * worth surviving, which is the half a cap can get wrong.
     *
     * @scenario "A provider-setup failure tells the customer how to fix it"
     */
    it("renders the remediation tips the gateway sent, up to the client's cap", () => {
      renderAlert({ error: gatewayError(vertexCredentialEnvelope) });

      for (const tip of vertexCredentialEnvelope.tips) {
        expect(screen.getByText(tip)).toBeInTheDocument();
      }
    });

    /**
     * The cap only constrains anything if the far side is asserted too:
     * asserting the first four are present passes just as well with the cap
     * raised to eight.
     *
     * @scenario "A provider-setup failure tells the customer how to fix it"
     */
    it("drops a tip past the client's cap rather than rendering a document", () => {
      const overLong = [
        ...vertexCredentialEnvelope.tips,
        "a fifth tip nobody should read",
      ];
      renderAlert({
        error: gatewayError({ ...vertexCredentialEnvelope, tips: overLong }),
      });

      expect(screen.getByText(overLong[0]!)).toBeInTheDocument();
      expect(screen.queryByText(overLong[4]!)).not.toBeInTheDocument();
    });

    /** @scenario "A provider-setup failure tells the customer how to fix it" */
    it("links the provider's own docs page, not a generic one", () => {
      renderAlert({ error: gatewayError(vertexCredentialEnvelope) });

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/ai-gateway/providers/vertex",
      );
    });

    /** @scenario "A provider-setup failure tells the customer how to fix it" */
    it("never tells the customer to retry a credential that cannot work", () => {
      const { container } = renderAlert({
        error: gatewayError(vertexCredentialEnvelope),
      });

      expect(container.textContent).not.toContain("timed out");
      expect(container.textContent).not.toContain("Try again in a moment");
    });

    /** @scenario "A provider-setup failure tells the customer how to fix it" */
    it("names the model the provider is not configured for", () => {
      renderAlert({
        error: gatewayError({
          code: "provider_config_invalid",
          fault: "customer",
          docsUrl: "https://docs.langwatch.ai/ai-gateway/providers/vertex",
          meta: { provider: "vertex", model: "gemini-3.1-pro-preview" },
          tips: [
            "Add the model to this provider's model list in Settings → Model Providers",
          ],
        }),
      });

      expect(
        screen.getByText(
          "Google Vertex AI is configured on this project, but not for gemini-3.1-pro-preview. Add it to that provider in Settings → Model Providers.",
        ),
      ).toBeInTheDocument();
    });

    /**
     * The cause that distinguishes the five credential failures from each
     * other is the operator's, and stays on the log line.
     */
    it("shows nothing of the engine's internal cause", () => {
      const { container } = renderAlert({
        error: gatewayError(vertexCredentialEnvelope),
      });

      expect(container.textContent).not.toContain("auth token source");
      expect(container.textContent).not.toContain("google auth credentials");
    });
  });

  describe("given a code the registry has copy for", () => {
    /** @scenario "A caller's generic headline loses to specific copy" */
    it("shows that copy rather than the caller's generic headline", () => {
      renderAlert({
        error: handledError({ code: "query_timeout" }),
        fallbackTitle: "Couldn't load the chart",
      });

      expect(screen.getByText("This search took too long")).toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't load the chart"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A recognised code is described by the registry, never by the wire" */
    it("never puts the code slug on screen", () => {
      const { container } = renderAlert({
        error: handledError({ code: "validation_error" }),
      });

      expect(container.textContent).not.toContain("validation_error");
    });
  });

  describe("given a code this client has no copy for", () => {
    /** @scenario "A caller's generic headline loses to specific copy" */
    it("falls back to the caller's headline", () => {
      renderAlert({
        error: handledError({ code: "a_code_from_a_newer_deploy" }),
        fallbackTitle: "Couldn't load the replicas",
      });

      expect(
        screen.getByText("Couldn't load the replicas"),
      ).toBeInTheDocument();
    });

    /** @scenario "Remediation reaches the customer when we have nothing better" */
    it("shows the server's tips, which are all the remediation there is", () => {
      renderAlert({
        error: handledError({
          code: "a_code_from_a_newer_deploy",
          tips: ["Check the connection", "Then try again"],
        }),
        fallbackTitle: "Couldn't load the replicas",
      });

      expect(screen.getByText("Check the connection")).toBeInTheDocument();
      expect(screen.getByText("Then try again")).toBeInTheDocument();
    });
  });

  describe("given a code the registry describes AND server tips", () => {
    /** @scenario "A tip that repeats our copy is dropped, one that adds to it is kept" */
    it("shows only the registry copy, so the alert doesn't say it twice", () => {
      renderAlert({
        error: handledError({
          code: "query_timeout",
          tips: ["Narrow the time range or add a filter"],
        }),
      });

      expect(
        screen.getByText(
          "Narrow the time range or add a filter, then try again.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Narrow the time range or add a filter"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a docs link", () => {
    /** @scenario "Remediation reaches the customer when we have nothing better" */
    it("offers an https one", () => {
      renderAlert({
        error: handledError({
          code: "query_timeout",
          docsUrl: "https://docs.langwatch.ai/errors/query-timeout",
        }),
      });

      expect(
        screen.getByRole("link", { name: /read the docs/i }),
      ).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/errors/query-timeout",
      );
    });

    /**
     * The payload is not always ours: a handled error relayed from a Go service
     * is parsed out of an upstream response body whose `docs_url` is typed as a
     * bare string, and that body comes from a customer-configured endpoint.
     * Neither React nor Chakra sanitises an `href`, so an unchecked value here
     * would run in the app's own origin on click.
     */
    it("refuses a javascript: one", () => {
      renderAlert({
        error: handledError({
          code: "query_timeout",
          // eslint-disable-next-line no-script-url
          docsUrl: "javascript:alert(document.cookie)",
        }),
      });

      expect(
        screen.queryByRole("link", { name: /read the docs/i }),
      ).not.toBeInTheDocument();
    });

    it("refuses a non-https one", () => {
      renderAlert({
        error: handledError({
          code: "query_timeout",
          docsUrl: "http://docs.langwatch.ai/errors",
        }),
      });

      expect(
        screen.queryByRole("link", { name: /read the docs/i }),
      ).not.toBeInTheDocument();
    });

    /**
     * https was never the property that mattered. The relayed value comes from
     * a customer-configured endpoint, so an off-origin https link would put
     * someone else's page behind our own "Read the docs".
     */
    it("refuses an https one that isn't our docs site", () => {
      renderAlert({
        error: handledError({
          code: "query_timeout",
          docsUrl: "https://docs.evil.example/langwatch/query-timeout",
        }),
      });

      expect(
        screen.queryByRole("link", { name: /read the docs/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a global interceptor already reported the error", () => {
    /**
     * `utils/api.tsx` opens the upgrade modal for a plan limit and a bespoke,
     * actionable toast for a missing model or a disabled provider.
     * `showErrorToast` has always stood down for those; the alert did not, so
     * a plan-limit refusal drew "Something went wrong / We've been notified"
     * underneath the modal that was busy explaining it properly.
     *
     * All four markers, because the guard listed only two of them — the two
     * that open modals — and the toast pair went on duplicating quietly.
     */
    it.each([
      ["the license limit modal", markAsHandledByLicenseHandler],
      ["the lite-member modal", markAsHandledByLiteMemberHandler],
      ["the missing-model toast", markAsHandledByMissingModelHandler],
      ["the provider-disabled toast", markAsHandledByProviderDisabledHandler],
    ])("renders nothing next to %s", (_label, markAsHandled) => {
      const error = Object.assign(new Error("resource_limit_exceeded"), {
        data: { error: { code: "resource_limit_exceeded", httpStatus: 403 } },
      });
      markAsHandled(error);

      const { container } = renderAlert({
        error,
        fallbackTitle: "Couldn't save",
      });

      expect(container).toBeEmptyDOMElement();
    });

    it("still renders one nothing has claimed", () => {
      const error = Object.assign(new Error("resource_limit_exceeded"), {
        data: { error: { code: "resource_limit_exceeded", httpStatus: 403 } },
      });

      renderAlert({ error, fallbackTitle: "Couldn't save" });

      expect(screen.getByText("You've hit a plan limit")).toBeInTheDocument();
    });
  });

  describe("given an error with nothing handled about it", () => {
    /** @scenario "An unhandled failure says nothing, but stays traceable" */
    it("says something calm and offers the id support can correlate on", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });

      renderAlert({
        error: { message: "boom", data: { traceId: "4bf92f3577b34da6" } },
        fallbackTitle: "Couldn't load the panel",
      });

      expect(screen.getByText("Couldn't load the panel")).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: /copy error id/i }),
      ).toBeInTheDocument();
    });

    /**
     * An insecure origin (a self-hosted instance on plain http) has no
     * `navigator.clipboard`, and the id used to be offered *only* as a copy
     * button — so the customer was left with a failure and nothing to quote to
     * support. Falling back to plain text is the difference between a
     * reportable error and an unreportable one.
     */
    /** @scenario "An error id stays readable where it cannot be copied" */
    it("shows the id as text when there is no clipboard to copy it to", () => {
      vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });

      renderAlert({
        error: { message: "boom", data: { traceId: "4bf92f3577b34da6" } },
        fallbackTitle: "Couldn't load the panel",
      });

      expect(screen.getByText(/4bf92f3577b34da6/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /copy error id/i }),
      ).not.toBeInTheDocument();
    });

    it("renders nothing at all when there is no error", () => {
      const { container } = renderAlert({ error: null });

      expect(container).toBeEmptyDOMElement();
    });
  });
});
