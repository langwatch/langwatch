/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ShareLinkView } from "../../../../model/share/share-link-status.ts";
import { ShareLinkRow } from "../share-link-row.tsx";

const link = {
  id: "share_1",
  token: "7f3a9c",
  resourceType: "TRACE",
  resourceId: "trace_1",
  threadId: null,
  projectId: "project_1",
  userId: null,
  visibility: "PUBLIC",
  expiresAt: null,
  maxViews: null,
  viewCount: 0,
  createdAt: "2026-08-27T12:00:00.000Z",
  updatedAt: "2026-08-27T12:00:00.000Z",
} satisfies ShareLinkView;

describe("given a share link row", () => {
  it("shows the token tail in a chip with the full URL on hover", () => {
    renderWithDesignSystem(
      <ShareLinkRow link={link} isFirst isRevoking={false} onCopy={vi.fn()} onRevoke={vi.fn()} />,
    );

    const chip = screen.getByTestId("share-link-url");
    expect(chip.textContent).toBe("…/share/7f3a9c");
    expect(chip.getAttribute("title")).toMatch(/^https?:\/\/.+\/share\/7f3a9c$/);
  });
});
