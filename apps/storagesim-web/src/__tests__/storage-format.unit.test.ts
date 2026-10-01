import { describe, expect, it } from "vitest";

import { formatSize, previewKind, stackFromHost, statusTone } from "../format.ts";

describe("formatSize", () => {
  it("scales bytes to the largest whole unit", () => {
    expect(formatSize({ bytes: 5 })).toBe("5 B");
    expect(formatSize({ bytes: 1536 })).toBe("1.5 KB");
  });
});

describe("previewKind", () => {
  it("previews text and images, and nothing else", () => {
    expect(previewKind({ contentType: "text/plain" })).toBe("text");
    expect(previewKind({ contentType: "application/json" })).toBe("text");
    expect(previewKind({ contentType: "image/png" })).toBe("image");
    expect(previewKind({ contentType: "binary/octet-stream" })).toBe("none");
  });
});

describe("stackFromHost", () => {
  it("names the stack from a storage host and is empty elsewhere", () => {
    expect(stackFromHost({ hostname: "storage.feature-one.langwatch.localhost" })).toBe(
      "feature-one",
    );
    expect(stackFromHost({ hostname: "127.0.0.1" })).toBe("");
  });
});

describe("statusTone", () => {
  it("reads 2xx as ok, 3xx neutral, 4xx warn and 5xx error", () => {
    expect([200, 302, 404, 503].map((status) => statusTone({ status }))).toEqual([
      "ok",
      "neutral",
      "warn",
      "error",
    ]);
  });
});
