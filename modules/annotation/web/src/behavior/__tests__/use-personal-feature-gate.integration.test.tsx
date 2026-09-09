/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutateAsync: vi.fn<({ projectId }: { projectId: string }) => Promise<void>>(),
}));

vi.mock("@langwatch/organization-web/personal-workspace-features", () => ({
  personalWorkspaceFeaturesApi: {
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: { datasets: false } }) },
      enableAll: { useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }) },
    },
    useUtils: () => ({ personalWorkspaceFeatures: { get: { invalidate: mocks.invalidate } } }),
  },
}));

const { usePersonalDatasetGate } = await import("../use-personal-feature-gate.ts");

describe("usePersonalDatasetGate", () => {
  it("shares one pending decision across repeated requests", async () => {
    mocks.mutateAsync.mockResolvedValue();

    const { result } = renderHook(() =>
      usePersonalDatasetGate({ projectId: "project-1", isOwnPersonalWorkspace: true }),
    );

    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;

    act(() => {
      first = result.current.requestEnable();
      second = result.current.requestEnable();
    });

    expect(second).toBe(first);
    act(() => result.current.dialogState.onCancel());
    await expect(first).resolves.toBe(false);
  });

  it("submits a pending decision once when confirm is clicked repeatedly", async () => {
    mocks.mutateAsync.mockResolvedValue();

    const { result } = renderHook(() =>
      usePersonalDatasetGate({ projectId: "project-1", isOwnPersonalWorkspace: true }),
    );

    let pending: Promise<boolean> | undefined;

    act(() => {
      pending = result.current.requestEnable();
      result.current.dialogState.onConfirm();
      result.current.dialogState.onConfirm();
    });

    await expect(pending).resolves.toBe(true);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ projectId: "project-1" });
  });

  it("cancels a pending decision when its project changes", async () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => usePersonalDatasetGate({ projectId, isOwnPersonalWorkspace: true }),
      { initialProps: { projectId: "project-1" } },
    );

    let pending: Promise<boolean> | undefined;

    act(() => {
      pending = result.current.requestEnable();
    });

    rerender({ projectId: "project-2" });

    await expect(pending).resolves.toBe(false);
    expect(result.current.dialogState.open).toBe(false);
  });

  it("cancels a pending decision when the caller unmounts", async () => {
    const { result, unmount } = renderHook(() =>
      usePersonalDatasetGate({ projectId: "project-1", isOwnPersonalWorkspace: true }),
    );

    let pending: Promise<boolean> | undefined;

    act(() => {
      pending = result.current.requestEnable();
    });

    unmount();

    await expect(pending).resolves.toBe(false);
  });

  it("does not let a previous project's confirmation settle a new decision", async () => {
    let finishFirst: () => void = () => {};

    mocks.mutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ projectId }) => usePersonalDatasetGate({ projectId, isOwnPersonalWorkspace: true }),
      { initialProps: { projectId: "project-1" } },
    );

    let first: Promise<boolean> | undefined;

    act(() => {
      first = result.current.requestEnable();
      result.current.dialogState.onConfirm();
    });

    rerender({ projectId: "project-2" });
    await expect(first).resolves.toBe(false);

    let second: Promise<boolean> | undefined;

    act(() => {
      second = result.current.requestEnable();
    });

    await act(async () => {
      finishFirst();
    });

    expect(result.current.dialogState.open).toBe(true);
    act(() => result.current.dialogState.onCancel());
    await expect(second).resolves.toBe(false);
  });
});
