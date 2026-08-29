// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnnotationAvatarGroup,
  AnnotationScoresChip,
  type AnnotationWithUser,
} from "../index";

afterEach(cleanup);

const annotation = ({
  id,
  userId,
  userName,
  scoreOptions = {},
}: {
  id: string;
  userId: string;
  userName: string;
  scoreOptions?: unknown;
}): AnnotationWithUser => ({
  id,
  projectId: "project-1",
  traceId: "trace-1",
  userId,
  comment: "comment",
  isThumbsUp: null,
  scoreOptions,
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: "2026-08-25T08:00:00.000Z",
  updatedAt: "2026-08-25T08:00:00.000Z",
  user: { id: userId, name: userName },
});

function withChakra(view: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{view}</ChakraProvider>);
}

describe("annotation presentation", () => {
  it("deduplicates reviewers while retaining the queue creator", () => {
    withChakra(
      <AnnotationAvatarGroup
        createdByUser={{ id: "user-1", name: "Alex" }}
        annotations={[
          annotation({ id: "annotation-1", userId: "user-1", userName: "Alex" }),
          annotation({ id: "annotation-2", userId: "user-2", userName: "Sam" }),
        ]}
        renderAvatar={(user) => (
          <span data-testid={`avatar-${user.id}`}>{user.name}</span>
        )}
      />,
    );

    expect(screen.getAllByTestId("avatar-user-1")).toHaveLength(1);
    expect(screen.getByTestId("avatar-user-2")).toHaveTextContent("Sam");
  });

  it("counts score answers rather than reviewers", () => {
    withChakra(
      <AnnotationScoresChip
        annotations={[
          annotation({
            id: "annotation-1",
            userId: "user-1",
            userName: "Alex",
            scoreOptions: {
              quality: { value: "good" },
              safety: { value: "safe" },
            },
          }),
        ]}
        traceId="trace-1"
      />,
    );

    expect(screen.getByLabelText("2 scores")).toHaveTextContent("2");
  });
});
