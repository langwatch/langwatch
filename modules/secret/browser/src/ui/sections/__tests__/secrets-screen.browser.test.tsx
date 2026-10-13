/**
 * Real-Chromium secrets loading: real timers decide whether the light skeleton ever paints, which
 * fake timers in jsdom can only simulate.
 * @see specs/secrets/secrets-manager.feature
 */

import { cleanup } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { renderWithSecretHost } from "../../../testing.tsx";

const { latency } = vi.hoisted(() => ({ latency: { ms: 0 } }));

/** An empty list that answers after `latency.ms`, loading until then. */
function useSlowEmptyList() {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAnswered(true), latency.ms);
    return () => clearTimeout(timer);
  }, []);
  return { data: answered ? [] : undefined, isLoading: !answered };
}

vi.mock("../../../behavior/secret-api.ts", () => ({
  secretApi: {
    useUtils: () => ({ secrets: { list: { invalidate: vi.fn() } } }),
    secrets: {
      list: { useQuery: useSlowEmptyList },
      create: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }) },
      update: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }) },
      delete: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }) },
    },
  },
}));

const { default: SecretsScreen } = await import("../secrets-screen.tsx");

const SKELETON = '[data-testid="secrets-loading"]';

/** Records when the skeleton or a table first reaches the DOM, if ever. */
function watchPaint() {
  const start = performance.now();
  const seen = { skeletonAt: undefined as number | undefined, table: false };
  const look = () => {
    if (seen.skeletonAt === undefined && document.querySelector(SKELETON)) {
      seen.skeletonAt = performance.now() - start;
    }
    if (document.querySelector("table")) seen.table = true;
  };
  const observer = new MutationObserver(look);
  observer.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}

beforeEach(async () => {
  await page.viewport(1024, 700);
});

afterEach(() => cleanup());

describe("given the project has no secrets", () => {
  describe("when the list answers well inside 300 ms", () => {
    /** @scenario A fast load never flashes a skeleton */
    it("goes straight to the empty state without painting a skeleton or a table", async () => {
      latency.ms = 50;
      const watch = watchPaint();

      renderWithSecretHost(<SecretsScreen />);

      await expect.element(page.getByText("No secrets configured")).toBeVisible();
      watch.stop();
      expect(watch.seen.skeletonAt).toBeUndefined();
      expect(watch.seen.table).toBe(false);
    });
  });

  describe("when the list is slow to answer", () => {
    /** @scenario A slow load shows a light skeleton */
    it("paints the skeleton rows only after the delay, still with no table", async () => {
      latency.ms = 1_200;
      const watch = watchPaint();

      renderWithSecretHost(<SecretsScreen />);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(document.querySelector(SKELETON)).toBeNull();

      await expect.poll(() => document.querySelector(SKELETON)).not.toBeNull();
      expect(watch.seen.skeletonAt).toBeGreaterThanOrEqual(290);
      expect(document.querySelector("table")).toBeNull();

      await expect.element(page.getByText("No secrets configured")).toBeVisible();
      watch.stop();
      expect(document.querySelector(SKELETON)).toBeNull();
    });
  });
});
