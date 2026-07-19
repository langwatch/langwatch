/** @vitest-environment node */
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { NotFoundError } from "@langwatch/handled-error";
import { errorFormatterForTesting } from "../trpc";

function format(error: TRPCError) {
  return errorFormatterForTesting({
    shape: {
      message: error.message,
      code: -32603,
      data: {
        code: error.code,
        httpStatus: 500,
        stack: "PrismaClientKnownRequestError at db.internal",
      },
    },
    error,
  });
}

describe("tRPC error response boundary", () => {
  it("masks an unexpected infrastructure error without removing it from the TRPCError", () => {
    const cause = new Error(
      "The findUnique action on LangyConversationProjection requires projectId",
    );
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: cause.message,
      cause,
    });

    const formatted = format(error);

    expect(formatted.message).toBe("An unknown error occurred");
    expect(JSON.stringify(formatted)).not.toContain("findUnique");
    expect(JSON.stringify(formatted)).not.toContain("db.internal");
    expect(error.cause).toBe(cause);
  });

  it("keeps explicitly handled domain copy and its structured envelope", () => {
    const cause = new NotFoundError(
      "langy_conversation_not_found",
      "Conversation",
      "conversation-1",
    );
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: cause.message,
      cause,
    });

    const formatted = format(error);

    expect(formatted.message).toBe("Conversation not found: conversation-1");
    expect(formatted.data.domainError).toMatchObject({
      code: "langy_conversation_not_found",
      httpStatus: 404,
    });
  });

  it("does not rewrite user-actionable 4xx errors", () => {
    const error = new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a project first",
    });

    expect(format(error).message).toBe("Choose a project first");
  });
});
