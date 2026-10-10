/**
 * @vitest-environment jsdom
 *
 * The one control that changes what a connection is called.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { renameMock, invalidateSetup, invalidateHistory } = vi.hoisted(() => ({
  renameMock: vi.fn(),
  invalidateSetup: vi.fn(),
  invalidateHistory: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      rename: {
        useMutation: () => ({ mutate: renameMock, isPending: false }),
      },
    },
    useUtils: () => ({
      ssoSetup: {
        getSetup: { invalidate: invalidateSetup },
        getHistory: { invalidate: invalidateHistory },
      },
    }),
  },
}));

vi.mock("../refusals", () => ({ reportRefusal: vi.fn() }));

import { ConnectionNameRow } from "../ConnectionNameRow";

const draw = (canManage: boolean) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ConnectionNameRow
        organizationId="org_acme"
        connectionId="ssoconn_acme"
        name="lw"
        canManage={canManage}
      />
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the connection's name on its card", () => {
  describe("given an administrator who may manage single sign-on", () => {
    /** @scenario "The name is offered for editing on the connection's card" */
    it("offers the name for editing in place, and saves the new one", () => {
      draw(true);

      expect(screen.getByTestId("connection-name").textContent).toBe("lw");
      fireEvent.click(screen.getByTestId("connection-name-edit"));

      fireEvent.change(screen.getByTestId("connection-name-input"), {
        target: { value: "Acme Okta" },
      });
      fireEvent.click(screen.getByTestId("connection-name-save"));

      expect(renameMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_acme",
          connectionId: "ssoconn_acme",
          name: "Acme Okta",
        }),
        expect.anything(),
      );
    });

    describe("when the name is emptied", () => {
      it("withholds the save rather than sending a blank one", () => {
        draw(true);
        fireEvent.click(screen.getByTestId("connection-name-edit"));
        fireEvent.change(screen.getByTestId("connection-name-input"), {
          target: { value: "   " },
        });

        expect(screen.getByTestId("connection-name-save")).toBeDisabled();
        fireEvent.click(screen.getByTestId("connection-name-save"));
        expect(renameMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a reader who may only look", () => {
    /** @scenario "The name is offered for editing on the connection's card" */
    it("is offered no way to change it", () => {
      draw(false);

      expect(screen.getByTestId("connection-name").textContent).toBe("lw");
      expect(screen.queryByTestId("connection-name-edit")).toBeNull();
    });
  });
});
