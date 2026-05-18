/**
 * @vitest-environment node
 *
 * Proves the tRPC wire mapping for `ModelNotConfiguredError`: a procedure
 * that throws it surfaces on the wire as a BAD_REQUEST TRPCError whose
 * `data.cause` carries the stable discriminator + feature metadata the
 * frontend interceptor needs.
 *
 * Binds the scenario `A tRPC procedure forwards ModelNotConfiguredError
 * as a typed TRPCError` in
 * specs/model-providers/model-resolver-and-registry.feature.
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { ModelNotConfiguredError } from "../../modelProviders/modelNotConfiguredError";
import { errorFormatterForTesting } from "../trpc";

describe("tRPC wire mapping for ModelNotConfiguredError", () => {
  /** @scenario A tRPC procedure forwards ModelNotConfiguredError as a typed TRPCError */
  it("serialises the typed error into data.cause for the frontend interceptor", () => {
    const cause = new ModelNotConfiguredError(
      "traces.ai_search",
      "FAST",
      "AI search",
      "proj_abc",
    );
    const trpcError = new TRPCError({
      code: "BAD_REQUEST",
      message: cause.message,
      cause,
    });

    const formatted = errorFormatterForTesting({
      shape: {
        message: trpcError.message,
        code: -32600,
        data: { code: "BAD_REQUEST", httpStatus: 400 },
      },
      error: trpcError,
    });

    expect(formatted.data.cause).toEqual({
      code: "MODEL_NOT_CONFIGURED",
      featureKey: "traces.ai_search",
      featureDisplayName: "AI search",
      role: "FAST",
      projectId: "proj_abc",
    });
  });
});
