import { describe, expect, it } from "vitest";
import { TrpcRootDefinition } from "../trpc-root.ts";
import { createTrpcHandlerBinding } from "../trpc-handler.ts";
import { createTrpcApiService, type AppTrpcPolicyMiddlewares } from "../trpc-api-service.ts";

type Context = { actor: { id: string } };
type App = { projects: string };

const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: undefined,
  logger: undefined,
  handledError: undefined,
  scopeLineageGuard: () => undefined,
  declaredCheck: () => undefined,
  enforceCheck: undefined,
  auditMutations: undefined,
};

describe("createTrpcApiService", () => {
  it("preserves a protected-only governed mount and its opaque handler binding", () => {
    const root = TrpcRootDefinition.forContext<Context>().create({});
    const handlerBinding = createTrpcHandlerBinding<Context, App>(async () => ({
      app: { projects: "projects" },
      actor: null,
      scope: null,
    }));

    const service = createTrpcApiService({
      root,
      protectedProcedure: root.procedure,
      middlewares,
      handlerBinding,
    });

    expect(service.protected).toBe(root.procedure);
    expect(service.handlerBinding).toBe(handlerBinding);
    expect("validateOutput" in service).toBe(false);
    expect("public" in service).toBe(false);
  });
});
