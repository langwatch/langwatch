/**
 * @vitest-environment jsdom
 *
 * An attribute value offers the same compact format selector the rest of the
 * drawer uses, and a value detected as a JSON string reads as JSON in it
 * rather than falling through to the first option.
 *
 * UX contract: specs/traces-v2/io-toolbar.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AttributeValue } from "../attribute-value";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

/**
 * The collapsed row is one button holding the value preview. Named by its
 * text rather than by being the only button, so another control appearing in
 * the row does not break every test here.
 */
const openValue = async ({
  user,
  preview,
}: {
  user: ReturnType<typeof userEvent.setup>;
  preview: string | RegExp;
}) => {
  await user.click(screen.getByRole("button", { name: preview }));
};

describe("given an attribute holding a chat-shaped value", () => {
  const chat = [
    { role: "user", content: "where is my order?" },
    { role: "assistant", content: "on its way" },
  ];

  /** @scenario "Attribute values use the same format selector" */
  it("offers chat, JSON and text through the format selector", async () => {
    const user = userEvent.setup();
    render(<AttributeValue attrKey="gen_ai.input.messages" value={chat} />, {
      wrapper,
    });

    await openValue({ user, preview: /Detected format: chat/ });

    const select = await screen.findByRole("button", {
      name: "Attribute value format",
    });
    expect(select).toHaveTextContent("Chat");

    await user.click(select);
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual([
      "Chat",
      "JSON",
      "Text",
    ]);
  });

  it("switches the rendering when another format is picked", async () => {
    const user = userEvent.setup();
    render(<AttributeValue attrKey="gen_ai.input.messages" value={chat} />, {
      wrapper,
    });

    await openValue({ user, preview: /Detected format: chat/ });
    await user.click(
      await screen.findByRole("button", { name: "Attribute value format" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Text" }));

    expect(
      screen.getByRole("button", { name: "Attribute value format" }),
    ).toHaveTextContent("Text");
  });
});

describe("given an attribute whose value is JSON inside a string", () => {
  /** @scenario "Attribute values use the same format selector" */
  it("reads as JSON in the selector rather than as the first option", async () => {
    const user = userEvent.setup();
    render(
      <AttributeValue
        attrKey="langwatch.reserved.value_types"
        value={'["langwatch.input=chat_messages","langwatch.output=text"]'}
      />,
      { wrapper },
    );

    await openValue({ user, preview: /Detected format: json/ });

    expect(
      await screen.findByRole("button", { name: "Attribute value format" }),
    ).toHaveTextContent("JSON");
  });
});
