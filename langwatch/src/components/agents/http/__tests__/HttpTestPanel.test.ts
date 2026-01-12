import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  formatDuration,
  getStatusColor,
} from "../HttpTestPanel";

describe("renderTemplate", () => {
  it("replaces single variable", () => {
    const result = renderTemplate("Hello {{name}}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = renderTemplate("{{greeting}} {{name}}!", {
      greeting: "Hi",
      name: "User",
    });
    expect(result).toBe("Hi User!");
  });

  it("replaces same variable multiple times", () => {
    const result = renderTemplate("{{x}} + {{x}} = 2{{x}}", { x: "1" });
    expect(result).toBe("1 + 1 = 21");
  });

  it("leaves unmatched placeholders unchanged", () => {
    const result = renderTemplate("Hello {{name}}", {});
    expect(result).toBe("Hello {{name}}");
  });

  it("handles empty template", () => {
    const result = renderTemplate("", { name: "World" });
    expect(result).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds under 1 second", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(1)).toBe("1ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats duration of exactly 1 second", () => {
    expect(formatDuration(1000)).toBe("1.00s");
  });

  it("formats duration over 1 second", () => {
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatDuration(2000)).toBe("2.00s");
    expect(formatDuration(12345)).toBe("12.35s");
  });
});

describe("getStatusColor", () => {
  it("returns green for 2xx status codes", () => {
    expect(getStatusColor(200)).toBe("green");
    expect(getStatusColor(201)).toBe("green");
    expect(getStatusColor(204)).toBe("green");
    expect(getStatusColor(299)).toBe("green");
  });

  it("returns blue for 3xx status codes", () => {
    expect(getStatusColor(300)).toBe("blue");
    expect(getStatusColor(301)).toBe("blue");
    expect(getStatusColor(304)).toBe("blue");
    expect(getStatusColor(399)).toBe("blue");
  });

  it("returns orange for 4xx status codes", () => {
    expect(getStatusColor(400)).toBe("orange");
    expect(getStatusColor(401)).toBe("orange");
    expect(getStatusColor(404)).toBe("orange");
    expect(getStatusColor(499)).toBe("orange");
  });

  it("returns red for 5xx status codes", () => {
    expect(getStatusColor(500)).toBe("red");
    expect(getStatusColor(502)).toBe("red");
    expect(getStatusColor(503)).toBe("red");
    expect(getStatusColor(599)).toBe("red");
  });

  it("returns red for status codes outside normal ranges", () => {
    expect(getStatusColor(100)).toBe("red");
    expect(getStatusColor(199)).toBe("red");
    expect(getStatusColor(600)).toBe("red");
  });
});
