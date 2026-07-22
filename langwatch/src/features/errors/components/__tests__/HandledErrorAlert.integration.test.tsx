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

const renderAlert = (props: Parameters<typeof HandledErrorAlert>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <HandledErrorAlert {...props} />
    </ChakraProvider>,
  );

describe("<HandledErrorAlert />", () => {
  describe("given a code the registry has copy for", () => {
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

    it("never puts the code slug on screen", () => {
      const { container } = renderAlert({
        error: handledError({ code: "validation_error" }),
      });

      expect(container.textContent).not.toContain("validation_error");
    });
  });

  describe("given a code this client has no copy for", () => {
    it("falls back to the caller's headline", () => {
      renderAlert({
        error: handledError({ code: "a_code_from_a_newer_deploy" }),
        fallbackTitle: "Couldn't load the replicas",
      });

      expect(
        screen.getByText("Couldn't load the replicas"),
      ).toBeInTheDocument();
    });

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
  });

  describe("given an error with nothing handled about it", () => {
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
