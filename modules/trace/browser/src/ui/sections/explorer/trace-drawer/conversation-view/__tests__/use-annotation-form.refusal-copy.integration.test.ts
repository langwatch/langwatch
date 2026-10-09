// @vitest-environment jsdom
/**
 * A refused annotation write shows the copy registered for its code (ADR-177 decision 8).
 *
 * @see specs/governance/aggregate-project.feature
 */
import type { UiFailureNotice } from "@langwatch/browser-host/capabilities";
import { setUiFeedbackHost } from "@langwatch/browser-host/toaster";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveErrorCopy } from "../../../../../../behavior/errors/logic/resolve-error-copy.ts";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toast: vi.fn(),
}));
let failed: UiFailureNotice[] = [];

vi.mock("../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("../../../../use-annotation-invalidation.ts", () => ({
  useAnnotationInvalidation: () => vi.fn(),
}));

vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: mocks.toast },
}));

vi.mock("../../../../../../behavior/trace-api.ts", () => ({
  api: {
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: mocks.create }) },
      updateByTraceId: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { useAnnotationMutations } from "../use-annotation-form.ts";

/** A tRPC client error carrying a handled payload, as the wire delivers it. */
function trpcRefusal(code: string) {
  return {
    message: code,
    data: { error: { code, httpStatus: 403, fault: "customer", meta: {} } },
  };
}

function saveAndFailWith(error: unknown) {
  const { result } = renderHook(() =>
    useAnnotationMutations({
      traceId: "trace-1",
      mode: "annotate",
      enabled: true,
      onDone: vi.fn(),
    }),
  );
  result.current.save({
    comment: "looks wrong",
    scoreOptions: {},
    expectedOutput: "",
  });
  const options = mocks.create.mock.calls[0]?.[1] as {
    onError: (error: unknown) => void;
  };
  options.onError(error);
  const notice = failed.at(-1);
  if (!notice) throw new Error("no failure was reported");
  return resolveErrorCopy({ error: notice.error, fallbackTitle: notice.fallbackTitle });
}

describe("useAnnotationMutations", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.toast.mockReset();
    failed = [];
    setUiFeedbackHost({ succeeded: () => {}, failed: (notice) => void failed.push(notice) });
  });

  afterEach(() => {
    setUiFeedbackHost(void 0);
  });

  describe("when the server refuses the save as read only", () => {
    /** @scenario "A refused annotation on the aggregate says why" */
    it("shows the registered read-only copy", () => {
      const toast = saveAndFailWith(trpcRefusal("aggregate_project_is_read_only"));

      expect(toast.title).toBe("Data can't be added to this project");
    });
  });

  describe("when the save fails for a reason the server cannot name", () => {
    it("keeps the annotation's own title", () => {
      const toast = saveAndFailWith(new Error("socket hang up"));

      expect(toast.title).toBe("Could not save annotation");
    });
  });
});
