/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTypeLabel,
  TYPE_LABELS,
  VariableTypeBadge,
  VariableTypeIcon,
} from "../VariableTypeIcon";

describe("TYPE_LABELS", () => {
  it("maps str to Text", () => {
    expect(TYPE_LABELS["str"]).toBe("Text");
  });

  it("maps string to Text", () => {
    expect(TYPE_LABELS["string"]).toBe("Text");
  });

  it("maps float to Number", () => {
    expect(TYPE_LABELS["float"]).toBe("Number");
  });

  it("maps int to Number", () => {
    expect(TYPE_LABELS["int"]).toBe("Number");
  });

  it("maps bool to Boolean", () => {
    expect(TYPE_LABELS["bool"]).toBe("Boolean");
  });

  it("maps boolean to Boolean", () => {
    expect(TYPE_LABELS["boolean"]).toBe("Boolean");
  });

  it("maps image to Image", () => {
    expect(TYPE_LABELS["image"]).toBe("Image");
  });

  it("maps list to List", () => {
    expect(TYPE_LABELS["list"]).toBe("List");
  });

  it("maps dict to Object", () => {
    expect(TYPE_LABELS["dict"]).toBe("Object");
  });

  it("maps json to Object", () => {
    expect(TYPE_LABELS["json"]).toBe("Object");
  });

  it("maps chat_messages to Messages", () => {
    expect(TYPE_LABELS["chat_messages"]).toBe("Messages");
  });
});

describe("getTypeLabel", () => {
  it("returns human-readable label for known types", () => {
    expect(getTypeLabel("str")).toBe("Text");
    expect(getTypeLabel("float")).toBe("Number");
    expect(getTypeLabel("bool")).toBe("Boolean");
    expect(getTypeLabel("dict")).toBe("Object");
  });

  it("returns the type itself for unknown types", () => {
    expect(getTypeLabel("custom_type")).toBe("custom_type");
    expect(getTypeLabel("unknown")).toBe("unknown");
  });
});

describe("VariableTypeIcon", () => {
  const renderIcon = (type: string) => {
    return render(
      <ChakraProvider value={defaultSystem}>
        <VariableTypeIcon type={type} />
      </ChakraProvider>,
    );
  };

  it("renders without crashing for str type", () => {
    const { container } = renderIcon("str");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing for float type", () => {
    const { container } = renderIcon("float");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing for bool type", () => {
    const { container } = renderIcon("bool");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing for list type", () => {
    const { container } = renderIcon("list");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing for dict type", () => {
    const { container } = renderIcon("dict");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing for chat_messages type", () => {
    const { container } = renderIcon("chat_messages");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders fallback icon for unknown type", () => {
    const { container } = renderIcon("unknown_type");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("VariableTypeBadge", () => {
  const renderBadge = (type: string, size?: "xs" | "sm") => {
    return render(
      <ChakraProvider value={defaultSystem}>
        <VariableTypeBadge type={type} size={size} />
      </ChakraProvider>,
    );
  };

  afterEach(() => {
    cleanup();
  });

  it("displays human-readable label for str type", () => {
    const { container } = renderBadge("str");
    expect(container.textContent).toBe("Text");
  });

  it("displays human-readable label for float type", () => {
    const { container } = renderBadge("float");
    expect(container.textContent).toBe("Number");
  });

  it("displays human-readable label for bool type", () => {
    const { container } = renderBadge("bool");
    expect(container.textContent).toBe("Boolean");
  });

  it("displays human-readable label for dict type", () => {
    const { container } = renderBadge("dict");
    expect(container.textContent).toBe("Object");
  });

  it("displays human-readable label for list type", () => {
    const { container } = renderBadge("list");
    expect(container.textContent).toBe("List");
  });

  it("renders with xs size", () => {
    const { container } = renderBadge("str", "xs");
    expect(container.textContent).toBe("Text");
  });

  it("renders with sm size", () => {
    const { container } = renderBadge("str", "sm");
    expect(container.textContent).toBe("Text");
  });
});
