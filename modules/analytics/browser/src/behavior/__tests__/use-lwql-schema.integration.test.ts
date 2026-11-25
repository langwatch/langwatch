/**
 * @vitest-environment jsdom
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("../analytics-api.ts", () => ({
  analyticsApi: { analytics: { lwql: { schema: { useQuery: useQueryMock } } } },
}));

import { useLwqlSchema } from "../use-lwql-schema.ts";

describe("useLwqlSchema()", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  describe("given a widget query in a project", () => {
    describe("when its schema is read", () => {
      /** @scenario "The dashboard widget reads the schema of its own project for the editor" */
      it("asks for that project's schema and gives none when the read failed", () => {
        useQueryMock.mockReturnValue({ data: undefined, isError: true });
        const { result } = renderHook(() => useLwqlSchema({ projectId: "project_1" }));
        expect(useQueryMock).toHaveBeenCalledWith(
          { projectId: "project_1" },
          expect.objectContaining({ retry: false }),
        );
        expect(result.current).toBeUndefined();
      });
    });
  });
});
