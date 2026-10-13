/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { fireEvent, screen } from "@testing-library/react";
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
  it("shows who made the link and when, never the token, and copies the full URL", () => {
    const onCopy = vi.fn();
    const createdAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    renderWithDesignSystem(
      <ShareLinkRow
        link={{ ...link, createdAt }}
        creatorName="Ada"
        isFirst
        isRevoking={false}
        onCopy={onCopy}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByTestId("share-link-created").textContent).toBe(
      "Created by Ada, about 2 hours ago",
    );
    expect(screen.getByTestId("share-link-row").textContent).not.toContain("7f3a9c");
    fireEvent.click(screen.getByTestId("share-link-copy"));
    expect(onCopy).toHaveBeenCalledWith(expect.stringMatching(/\/share\/7f3a9c$/));
  });
});
