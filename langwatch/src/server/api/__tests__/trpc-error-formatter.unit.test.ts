/** @vitest-environment node */
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { HandledError, NotFoundError } from "@langwatch/handled-error";
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

  it("replaces a handled error's free-text message with its stable code, keeping the structured envelope", () => {
    const cause = new NotFoundError(
      "langy_conversation_not_found",
      "Conversation",
      "conversation-1",
    );
    const error = new TRPCError({
      code: "NOT_FOUND",
      message: cause.message,
      cause,
    });

    const formatted = format(error);

    expect(formatted.message).toBe("langy_conversation_not_found");
    expect(JSON.stringify(formatted)).not.toContain(
      "Conversation not found: conversation-1",
    );
    expect(formatted.data.domainError).toMatchObject({
      code: "langy_conversation_not_found",
      httpStatus: 404,
    });
  });

  it("never leaks server configuration named in a handled error's message", () => {
    // Mirrors the reported leak: langy.createConversation returned
    // "LW_GATEWAY_BASE_URL is not configured on the control plane." as the
    // wire message alongside the sanitised domainError payload.
    class CredentialResolutionError extends HandledError {
      constructor(message: string) {
        super("langy_credential_resolution", message, { httpStatus: 409 });
      }
    }
    const cause = new CredentialResolutionError(
      "LW_GATEWAY_BASE_URL is not configured on the control plane.",
    );
    const error = new TRPCError({
      code: "CONFLICT",
      message: cause.message,
      cause,
    });

    const formatted = format(error);

    expect(JSON.stringify(formatted)).not.toContain("LW_GATEWAY_BASE_URL");
    expect(JSON.stringify(formatted)).not.toContain("db.internal");
    expect(formatted.message).toBe("langy_credential_resolution");
    expect(formatted.data.domainError).toMatchObject({
      code: "langy_credential_resolution",
      httpStatus: 409,
      fault: "customer",
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
