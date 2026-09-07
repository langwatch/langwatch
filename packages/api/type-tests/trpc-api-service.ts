import {
  createTrpcApiService,
  createTrpcService,
  TrpcRootDefinition,
  type AppTrpcPolicyMiddlewares,
  type TrpcHandlerBinding,
} from "@langwatch/api/trpc";
import { createTrpcHandlerBinding } from "@langwatch/api/composition";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

type Context = { actor: { id: string } };
type App = { projects: string };

const root = TrpcRootDefinition.forContext<Context>().create({});
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: undefined,
  logger: undefined,
  handledError: undefined,
  scopeLineageGuard: () => undefined,
  declaredCheck: () => undefined,
  enforceCheck: undefined,
  auditMutations: undefined,
};

const governedProtected = createTrpcApiService({
  root,
  protectedProcedure: root.procedure,
  middlewares,
  handlerBinding: createTrpcHandlerBinding<Context, App>(async () => ({
    app: { projects: "projects" },
    actor: null,
    scope: null,
  })),
});

const governedPublic = createTrpcApiService({
  root,
  protectedProcedure: root.procedure,
  publicProcedure: root.procedure,
  middlewares,
  handlerBinding: createTrpcHandlerBinding<Context, App>(async () => ({
    app: { projects: "projects" },
    actor: null,
    scope: null,
  })),
});

const legacyProtected = createTrpcApiService({
  root,
  protectedProcedure: root.procedure,
  middlewares,
  validateOutput: true,
});

const legacyPublic = createTrpcApiService({
  root,
  protectedProcedure: root.procedure,
  publicProcedure: root.procedure,
  middlewares,
  validateOutput: false,
});

const governedBinding: TrpcHandlerBinding<Context, App> = governedProtected.handlerBinding;
const governedRouter = createTrpcService({
  root,
  procedures: governedProtected,
  handlerBinding: governedBinding,
});
governedRouter
  .query("governed", (procedure) =>
    procedure
      .withInput(z.object({ projectId: z.string() }))
      .withOutput(z.object({ id: z.string() }))
      .withCustomPermission(governedProtected.policy("project:view"), "type test")
      .handle(({ input, app, scope }) => ({
        id: `${input.projectId}:${app.projects}:${scope?.id ?? "none"}`,
      })),
  )
  .build();

const _publicGovernedBinding: TrpcHandlerBinding<Context, App> = governedPublic.handlerBinding;
type _ProtectedLegacyOutputValidationIsBoolean = Assert<
  Equal<typeof legacyProtected.validateOutput, boolean>
>;
type _PublicLegacyOutputValidationIsBoolean = Assert<
  Equal<typeof legacyPublic.validateOutput, boolean>
>;
