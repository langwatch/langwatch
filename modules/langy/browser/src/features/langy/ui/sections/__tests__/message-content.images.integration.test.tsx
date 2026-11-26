/**
 * A sent message shows its images from signed URLs and its chips by file name.
 * @vitest-environment jsdom
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const minted = vi.hoisted(() => ({ inputs: [] as unknown[] }));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: () => {} }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "demo" } }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    storedObjects: {
      getReadUrl: {
        useQuery: (input: { storedObjectId: string }) => {
          minted.inputs.push(input);
          return { data: { url: `https://bucket.example/${input.storedObjectId}?sig=1` } };
        },
      },
    },
  },
}));

import { MessageContent } from "../message-content.tsx";

afterEach(cleanup);

const sent: UIMessage = {
  id: "m-user",
  role: "user",
  parts: [
    { type: "text", text: "What does [▣ chart.png] show?" },
    {
      type: "file",
      mediaType: "image/png",
      filename: "chart.png",
      url: "/api/files/project_1/storedobject_a/chart.png",
    },
  ],
};

describe("given a sent user message that carries a stored image", () => {
  describe("when the conversation shows it", () => {
    /** @scenario A sent message shows its images from signed URLs */
    it("draws the image from its signed URL and the chip by its file name", () => {
      render(
        <DesignSystemProvider forcedTheme="light">
          <MessageContent
            message={sent}
            appliedOutcomes={{}}
            discardedProposals={new Set()}
            applyingProposals={new Set()}
            onApply={async () => {}}
            onDiscard={() => {}}
          />
        </DesignSystemProvider>,
      );

      expect(screen.getByRole("img", { name: "chart.png" })).toHaveAttribute(
        "src",
        "https://bucket.example/storedobject_a?sig=1",
      );
      expect(minted.inputs).toContainEqual({
        projectId: "project_1",
        storedObjectId: "storedobject_a",
        filename: "chart.png",
      });
      expect(screen.getByTestId("langy-user-message")).toHaveTextContent(
        "What does chart.png show?",
      );
    });
  });
});
