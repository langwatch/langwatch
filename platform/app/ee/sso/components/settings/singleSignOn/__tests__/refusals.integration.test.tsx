/**
 * @vitest-environment jsdom
 *
 * Which sentence an inline refusal leads with.
 *
 * `InlineRefusal` takes the act it is reporting on (`what`) so an unrecognised
 * failure can say "Registering that connection didn't work" rather than
 * "Something went wrong". It used to render that act WHENEVER it was given —
 * so a refusal the registry has written copy for showed the generic act as its
 * title above the registry's own description, and the two halves of the alert
 * described different failures. `sso_issuer_unreachable` is the case that
 * found it: the description told the reader to check the issuer address while
 * the title said only that registering had not worked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineRefusal } from "../refusals";

/**
 * The wire shape a tRPC refusal actually arrives in — `data.error` carrying a
 * `code` and an `httpStatus`, which is what `readHandledError` reads. Built
 * here rather than mocked so this test fails if that reading changes.
 */
const handledRefusal = (code: string) => ({
  data: {
    error: {
      code,
      kind: code,
      httpStatus: 422,
      fault: "customer",
      meta: {},
      reasons: [{ code: "unknown", kind: "unknown" }],
    },
  },
});

const renderRefusal = (props: { error: unknown; what?: string }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <InlineRefusal {...props} />
    </ChakraProvider>,
  );

describe("InlineRefusal", () => {
  describe("given a refusal the registry has copy for", () => {
    it("leads with the registered title rather than the act it was given", () => {
      renderRefusal({
        error: handledRefusal("sso_issuer_unreachable"),
        what: "Registering that connection",
      });

      expect(
        screen.getByText("That address did not answer as an identity provider"),
      ).toBeTruthy();
      expect(
        screen.queryByText(/Registering that connection didn't work/),
      ).toBe(null);
    });

    it("keeps the title and the description describing the same failure", () => {
      renderRefusal({
        error: handledRefusal("sso_issuer_unreachable"),
        what: "Registering that connection",
      });

      // The description is the registry's, and always was. The title going
      // its own way is what made the alert read as two different failures.
      expect(screen.getByText(/Check the issuer address/)).toBeTruthy();
      expect(
        screen.getByText("That address did not answer as an identity provider"),
      ).toBeTruthy();
    });
  });

  describe("given a failure with no registered copy", () => {
    it("names the act, which says more than the unknown title would", () => {
      renderRefusal({
        error: new Error("connection reset"),
        what: "Registering that connection",
      });

      expect(
        screen.getByText("Registering that connection didn't work"),
      ).toBeTruthy();
    });

    it("falls back to the unknown title when no act was named", () => {
      renderRefusal({ error: new Error("connection reset") });

      expect(screen.getByText("Something went wrong")).toBeTruthy();
    });
  });

  describe("given no error at all", () => {
    it("renders nothing", () => {
      const { container } = renderRefusal({ error: null });

      expect(container.textContent).toBe("");
    });
  });
});
