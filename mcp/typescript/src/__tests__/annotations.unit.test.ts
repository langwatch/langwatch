import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", () => ({
  makeRequest: vi.fn(),
}));

import { makeRequest } from "../langwatch-api.js";
import {
  listAnnotations,
  getAnnotation,
  getAnnotationsByTrace,
  createAnnotation,
} from "../langwatch-api-annotations.js";
import { handleListAnnotations } from "../tools/list-annotations.js";

const mockMakeRequest = vi.mocked(makeRequest);

const annotation = {
  id: "annotation_1",
  traceId: "trace_1",
  comment: "Great answer",
  isThumbsUp: true,
  email: "reviewer@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// The annotations endpoints answer `{ "data": … }` (#7866, sibling of the
// TypeScript SDK fix in #7865). The API layer must hand callers the payload,
// not the envelope.
describe("annotations API envelope", () => {
  describe("when the server answers { data: [...] }", () => {
    it("listAnnotations returns the array, not the envelope", async () => {
      mockMakeRequest.mockResolvedValue({ data: [annotation] });

      const result = await listAnnotations();

      expect(result).toEqual([annotation]);
      expect(result.filter((a) => a.isThumbsUp)).toHaveLength(1);
    });

    it("getAnnotationsByTrace returns the array", async () => {
      mockMakeRequest.mockResolvedValue({ data: [annotation] });

      await expect(getAnnotationsByTrace("trace_1")).resolves.toEqual([
        annotation,
      ]);
    });
  });

  describe("when the server answers { data: {...} }", () => {
    it("getAnnotation returns the annotation", async () => {
      mockMakeRequest.mockResolvedValue({ data: annotation });

      await expect(getAnnotation("annotation_1")).resolves.toEqual(annotation);
    });

    it("createAnnotation returns the created annotation", async () => {
      mockMakeRequest.mockResolvedValue({ data: annotation });

      await expect(
        createAnnotation("trace_1", { comment: "Great answer", isThumbsUp: true }),
      ).resolves.toEqual(annotation);
    });
  });

  describe("when a 2xx body carries no data envelope", () => {
    it("refuses a bare array instead of returning a lookalike shape", async () => {
      mockMakeRequest.mockResolvedValue([annotation]);

      await expect(listAnnotations()).rejects.toThrow('no "data" envelope');
    });

    it("refuses a null data payload", async () => {
      mockMakeRequest.mockResolvedValue({ data: null });

      await expect(getAnnotation("annotation_1")).rejects.toThrow(
        'no "data" envelope',
      );
    });
  });
});

describe("platform_list_annotations through the tool layer", () => {
  it("renders annotations from an enveloped response", async () => {
    mockMakeRequest.mockResolvedValue({ data: [annotation] });

    const text = await handleListAnnotations({});

    expect(text).toContain("Annotations (1 total)");
    expect(text).toContain("annotation_1");
    expect(text).toContain("👍");
  });

  it("reports an empty project from an enveloped empty list", async () => {
    mockMakeRequest.mockResolvedValue({ data: [] });

    const text = await handleListAnnotations({});

    expect(text).toContain("No annotations found");
  });
});
