/**
 * A schema parse that fails inside a service, served through the API application's own protected
 * procedure (the host's), answers the validation failure.
 * Spec: specs/errors/handled-error-surfaces.feature.
 */
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { SessionReader } from "../../hosting/session-reader.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface ReviewApi {
  read(input: { id: string }): { id: string };
}

const ReviewApi = moduleApi<ReviewApi>()("annotation");

const reads = defineTrpcRouter(
  ReviewApi,
  defineTrpcContract("review")
    .query("getById")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .build(),
)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .build();

const FIELD_FAILURE = () => z.object({ name: z.string().min(1) }).parse({ name: "" });

async function callThroughHost(): Promise<{
  status: number;
  error?: { data?: { code?: string; error?: { code?: string; httpStatus?: number } } };
}> {
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz: {
      getDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    },
    logger: { warn: () => void 0, error: () => void 0 },
  });
  const service: ReviewApi = {
    read: () => {
      FIELD_FAILURE();

      return { id: "never" };
    },
  };
  trpc.mount(composeTrpcRouters("review", [reads]), () => service);

  const request = new Request(
    `http://api.test${TrpcHost.path}/review.getById?input=${encodeURIComponent(
      JSON.stringify({ projectId: "p1", id: "a" }),
    )}`,
  );
  const response = await fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request }),
  });
  const body = (await response.json()) as { error?: { data?: never } };

  return { status: response.status, ...body };
}

describe("a procedure served through the application's own protected procedure", () => {
  describe("when its service throws a schema parse failure", () => {
    /** @scenario "A schema parse inside a service is a validation failure on the application spine too" */
    it("answers validation_error at 422, not an unknown failure at 500", async () => {
      const answer = await callThroughHost();

      expect(answer.status).toBe(422);
      expect(answer.error?.data?.error).toMatchObject({
        code: "validation_error",
        httpStatus: 422,
      });
    });
  });
});
