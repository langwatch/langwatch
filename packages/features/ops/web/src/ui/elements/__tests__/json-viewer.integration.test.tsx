/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonViewer } from "../../../index";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("JsonViewer", () => {
  it("preserves structured values and highlights changed branches", () => {
    render(
      <JsonViewer
        previousData={{ status: "queued", events: [{ id: "event_1" }] }}
        data={{ status: "running", events: [{ id: "event_1" }, { id: "event_2" }] }}
      />,
      { wrapper },
    );

    expect(screen.getByText('"status"')).not.toBeNull();
    expect(screen.getByText('"running"')).not.toBeNull();
    expect(screen.getByText('"event_2"')).not.toBeNull();
  });
});
