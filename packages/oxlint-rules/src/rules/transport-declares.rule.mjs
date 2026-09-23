import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import {
  inspectDeclaredHandler,
  inspectHandlerBoundary,
  inspectHandlerConstruction,
  inspectHandlerShape,
} from "./transport-handler-checks.mjs";
import {
  declaredProducerFields,
  endpointHandlerArgument,
  handlerRegistration,
  isFunctionExpression,
  localFunctions,
  parameterPattern,
  propertyName,
  resolveHandler,
  stringKey,
  unwrapTypeAssertions,
} from "./transport-handlers.mjs";

// ARCHITECTURE.md §8: transport files declare; the framework parses, refuses,
// serialises, and a handler takes `{ input, app, actor, scope, signal }`, calls
// one API operation and returns a plain value or throws (ADR-133).

const SOURCE = /\.[cm]?[jt]sx?$/;
const TYPESCRIPT_SOURCE = /\.tsx?$/;
const TYPESCRIPT_TEST = /\.(?:test|spec)\.tsx?$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIRECTORY = /(?:^|\/)__(?:tests|mocks)__\//;
const NESTED_TRANSPORT = /^transport\/api-(rest|trpc)\/.+\.(?:api|rest|trpc)\.ts$/;
const API_TRANSPORT_DIRECTORY = /(?:^|\/)transport\/api-/;
const API_MODULE = /^@langwatch\/api(?:\/|$)/;
const HONO_OPENAPI = /^hono-openapi(?:\/|$)/;
const PATH_SEPARATOR = /[./]/;
const COMPOSITION_MODULE = "@langwatch/api/composition";
const API_BUILDERS = new Set([
  "createRestService",
  "createTrpcService",
  "createRestRouter",
  "createTrpcRouter",
]);
const RAW_APP_CONSTRUCTORS = new Set(["Hono", "OpenAPIHono"]);
const HONO_OPENAPI_DOORS = new Set(["describeRoute", "validator", "resolver"]);
const OUTPUT_BYPASS_CALLS = new Set(["withoutOutput", "validateOutput"]);
const LEGACY_RBAC_IDENTIFIERS = new Set([
  "TeamRoleGroup",
  "OrganizationUserRole",
  "checkUserPermission",
  "checkUserPermissionForProject",
  "checkUserPermissionForTeam",
  "checkUserPermissionForOrganization",
  "hasTeamPermission",
  "hasOrganizationPermission",
]);
const RAW_HONO_METHODS = new Set([
  "all",
  "delete",
  "get",
  "head",
  "on",
  "options",
  "patch",
  "post",
  "put",
  "route",
]);
const CREDENTIAL_CONTEXT_KEYS = new Set([
  "apiKeyId",
  "apiKeyUserId",
  "apiKeyOrganizationId",
  "resolvedToken",
  "orgResolvedToken",
]);
const DISPATCH_MEMBERS = new Set(["query", "mutate"]);
const ACCESS_MESSAGES = new Set(["rawContextAccess", "transportHeaders"]);
const CLASS_METHODS = new Set(["MethodDefinition", "TSAbstractMethodDefinition"]);
const PROPERTY_NODES = new Set([
  "PropertyDefinition",
  "TSAbstractPropertyDefinition",
  "TSPropertySignature",
]);

const HANDLER_FIELDS_FIX =
  'Take only `{ input, app, actor, scope, signal }` and the producer this route\'s own chain declares: `response` from `.withResponse(...)`, `request` from `.withResponse("protocol" | "forwarded", ...)`, `raw` from `.withRawBody(...)`, `files` from `.withMultipart(...)`; the framework resolves the session and the headers before the handler runs.';
const PLAIN_RESULT_FIX =
  "Return the plain value `.withOutput()` declares, or nothing for an empty response, and throw a `HandledError` to refuse; the framework serialises both.";
const DECLARE_ROUTE_FIX =
  "Declare the route with `defineRestRouter` or the procedure with `defineTrpcRouter`; the process builds and mounts the application.";
const PERMISSION_FIX =
  "Declare access with `.withPermission(...)` on the route or procedure; AuthZ decides it.";
const TYPED_DISPATCH_FIX =
  "Call the operation on the handler's `app`, or the typed client derived from the contract, so the compiler checks every procedure path.";

function frameworkSurface(file) {
  const nested = file.sourcePath.match(NESTED_TRANSPORT);
  if (nested) return nested[1];
  if (file.sourcePath === `transport/${file.feature}.rest.ts`) return "rest";

  return file.sourcePath === `transport/${file.feature}.trpc.ts` ? "trpc" : undefined;
}

/** The three readings a process source gets: every source, transport files, route families. */
function scopeOf(file) {
  const path = file.workspacePath;
  const featureServer =
    TYPESCRIPT_SOURCE.test(path) && !path.includes("/__tests__/") && !TYPESCRIPT_TEST.test(path);
  const production = !TEST_SOURCE.test(path) && !TEST_DIRECTORY.test(path);
  const boundary = production && file.sourcePath.startsWith("transport/");
  const surface = production ? frameworkSurface(file) : undefined;

  return { boundary, featureServer, surface };
}

function isProcessSource(file) {
  return (
    file.role === "process" && file.sourcePath !== undefined && SOURCE.test(file.workspacePath)
  );
}

function createTools(context) {
  const seen = new Set();
  const source = context.sourceCode.text;

  return {
    text: (node) => source.slice(node.start, node.end),
    report(node, messageId, data) {
      const group = ACCESS_MESSAGES.has(messageId) ? "access" : messageId;
      const key = `${group}|${node.start}|${node.end}`;
      if (seen.has(key)) return;
      seen.add(key);
      context.report({ node, messageId, data });
    },
  };
}

function importedName(specifier) {
  if (specifier.type === "ImportDefaultSpecifier") return specifier.local.name;

  return specifier.imported.name ?? specifier.imported.value;
}

function recordNamedImport({ imported, local, module, found }) {
  if (imported === "createTrpcHandlerBinding") found.bindings.add(local);
  if (API_BUILDERS.has(imported)) found.builders.add(local);
  if (module === "hono" && RAW_APP_CONSTRUCTORS.has(imported)) found.rawApps.add(local);
  if (module === "@trpc/server" && imported === "initTRPC") found.rawTrpc.add(local);
}

function recordImport(statement, found) {
  const module = statement.source.value;
  const fromApi = API_MODULE.test(module);
  if (fromApi) found.hasApiImport = true;
  for (const specifier of statement.specifiers) {
    const local = specifier.local.name;
    if (specifier.type === "ImportSpecifier") {
      recordNamedImport({ found, imported: importedName(specifier), local, module });
    } else if (specifier.type === "ImportNamespaceSpecifier" && fromApi) {
      found.namespaces.add(local);
      found.bindings.add(`${local}.createTrpcHandlerBinding`);
    }
  }
}

/** What the imports say about a source: framework builders, raw roots, the composition module. */
function importAnalysis(program) {
  const found = {
    bindings: new Set(),
    builders: new Set(),
    compositionStatements: [],
    hasApiImport: false,
    namespaces: new Set(),
    rawApps: new Set(),
    rawTrpc: new Set(),
  };
  for (const statement of program.body) {
    const module = statement.source?.value;
    if (module === COMPOSITION_MODULE) found.compositionStatements.push(statement);
    if (statement.type === "ImportDeclaration") recordImport(statement, found);
  }

  return found;
}

function declaresTransports(file, imports) {
  const namesBuilders = imports.builders.size > 0 || imports.namespaces.size > 0;

  return API_TRANSPORT_DIRECTORY.test(file.sourcePath) || namesBuilders || imports.hasApiImport;
}

function calleeText(callee, tools) {
  if (callee.type === "Identifier") return callee.name;
  const name = propertyName(callee);

  return name === undefined ? "" : `${tools.text(callee.object)}.${name}`;
}

function reportRootCalls(node, imports, tools) {
  const text = calleeText(node.callee, tools);
  if (imports.bindings.has(text) || text.endsWith(".createTrpcHandlerBinding")) {
    tools.report(node, "handlerBindingCall");
  }
  const { callee } = node;
  if (callee.type === "Identifier" && imports.rawTrpc.has(callee.name)) {
    tools.report(node, "trpcRoot", { call: callee.name });
  }
  if (propertyName(callee) === "context" && imports.rawTrpc.has(callee.object.name)) {
    tools.report(node, "trpcRoot", { call: `${callee.object.name}.context()` });
  }
}

function isValidateOutputOff(node) {
  const plain = node.kind === "init" && !node.method && !node.shorthand && !node.computed;

  return plain && node.key.name === "validateOutput" && node.value.value === false;
}

function calleeIdentifier(node) {
  return node.callee.type === "Identifier" ? node.callee.name : undefined;
}

function inspectModuleCall(node, state, tools) {
  reportRootCalls(node, state.imports, tools);
  if (!state.declaresTransports) return;
  const name = propertyName(node.callee);
  if (OUTPUT_BYPASS_CALLS.has(name)) tools.report(node, "outputUnchecked", { how: `.${name}()` });
  if (name === "handle") inspectDeclaredHandler({ call: node, program: state.program, tools });
}

function featureServerVisitors(state, tools) {
  return {
    CallExpression: (node) => inspectModuleCall(node, state, tools),
    ImportExpression(node) {
      const composition = node.source.value === COMPOSITION_MODULE;
      if (composition && !node.options) tools.report(node, "compositionImport");
    },
    NewExpression(node) {
      const name = calleeIdentifier(node);
      if (state.imports.rawApps.has(name)) tools.report(node, "rawApp", { name });
    },
    Property(node) {
      if (!state.declaresTransports || !isValidateOutputOff(node)) return;
      tools.report(node, "outputUnchecked", { how: "validateOutput: false" });
    },
  };
}

function restImportChecks({ names, statement, module, tools }) {
  const doors = names.filter((name) => HONO_OPENAPI_DOORS.has(name));
  if (HONO_OPENAPI.test(module) && doors.length > 0) {
    tools.report(statement, "openapiDoorImport", { names: doors.join(", "), specifier: module });
  }
  if (module === "@hono/zod-validator") tools.report(statement, "zodValidatorImport");
}

function frameworkImportChecks(program, surface, tools) {
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const module = statement.source.value;
    const names = statement.specifiers
      .filter((specifier) => specifier.type !== "ImportNamespaceSpecifier")
      .map(importedName);
    if (module.split("/").includes("rbac"))
      tools.report(statement, "rbacImport", { specifier: module });
    if (surface === "rest") restImportChecks({ module, names, statement, tools });
    const trpcRoot = module.startsWith("@trpc/server") && names.includes("initTRPC");
    if (surface === "trpc" && trpcRoot) tools.report(statement, "trpcRoot", { call: "initTRPC" });
  }
}

/** `{ key: value }` in an object literal names nothing; a destructuring or shorthand does. */
function isPlainObjectEntry(parent) {
  const plain = parent.type === "Property" && !parent.shorthand && !parent.method;

  return plain && parent.parent?.type === "ObjectExpression";
}

function reportLegacyRbacName(node, tools) {
  if (!LEGACY_RBAC_IDENTIFIERS.has(node.name)) return;
  if (node.parent.type === "ImportSpecifier" || isPlainObjectEntry(node.parent)) return;
  tools.report(node, "legacyRbacName", { name: node.name });
}

function reportTrpcChainBypass(node, tools) {
  const name = calleeIdentifier(node) ?? propertyName(node.callee);
  if (name === "router" && node.arguments.length === 1) tools.report(node, "bareRouter");
  if (name === "input") tools.report(node, "trpcInput");
}

function reportOwnRestApp(node, tools) {
  const name = calleeIdentifier(node);
  if (RAW_APP_CONSTRUCTORS.has(name)) tools.report(node, "rawApp", { name });
}

function frameworkVisitors(surface, tools) {
  const visitors = { Identifier: (node) => reportLegacyRbacName(node, tools) };
  if (surface === "rest") visitors.NewExpression = (node) => reportOwnRestApp(node, tools);
  if (surface === "trpc") visitors.CallExpression = (node) => reportTrpcChainBypass(node, tools);

  return visitors;
}

function namedImportsOf(program) {
  const names = new Map();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers.filter(
      (entry) => entry.type === "ImportSpecifier",
    )) {
      names.set(specifier.local.name, importedName(specifier));
    }
  }

  return names;
}

function stringArgument(call) {
  const [first] = call.arguments;

  return typeof first?.value === "string" && first.type === "Literal" ? first.value : undefined;
}

function reportContextCredential(node, tools) {
  const key = node.arguments.length === 1 ? stringArgument(node) : undefined;
  if (propertyName(node.callee) === "get" && CREDENTIAL_CONTEXT_KEYS.has(key)) {
    tools.report(node, "credentialFromContext", { key });
  }
}

function reportStringPathDispatch(node, tools) {
  const member = propertyName(node.callee) ?? stringKey(node.callee);
  const path = DISPATCH_MEMBERS.has(member) ? stringArgument(node) : undefined;
  if (path !== undefined && PATH_SEPARATOR.test(path))
    tools.report(node, "stringPathCall", { path });
}

function keyName(node) {
  if (node.computed) return undefined;

  return node.key.type === "Identifier" ? node.key.name : node.key.value;
}

function isStringParameter(parameter) {
  return parameter?.typeAnnotation?.typeAnnotation.type === "TSStringKeyword";
}

function returnsPromise(returnType) {
  const type = returnType?.typeAnnotation;

  return !type || (type.type === "TSTypeReference" && type.typeName.name === "Promise");
}

/** The signature a `query`/`mutate` member declares, when it declares one. */
function dispatchSignature(node) {
  if (node.type === "TSMethodSignature") return node;
  if (CLASS_METHODS.has(node.type) || (node.type === "Property" && node.method)) return node.value;
  const type = PROPERTY_NODES.has(node.type) ? node.typeAnnotation?.typeAnnotation : undefined;

  return type?.type === "TSFunctionType" ? type : undefined;
}

function reportGenericDispatch(node, tools) {
  const signature = dispatchSignature(node);
  const name = signature ? keyName(node) : undefined;
  if (!DISPATCH_MEMBERS.has(name) || !isStringParameter(signature.params[0])) return;
  if (returnsPromise(signature.returnType)) tools.report(node, "stringDispatch", { name });
}

function reportRegistration(registration, tools) {
  const { candidate, fluent } = registration;
  if (!fluent) tools.report(candidate, "legacyRegisterRoute");
  if (fluent && !isFunctionExpression(unwrapTypeAssertions(candidate))) {
    tools.report(candidate, "handlerNotInline");
  }
}

function inspectRouteCall(node, state, tools) {
  const endpoint = resolveHandler(endpointHandlerArgument(node), state.functions);
  if (endpoint && !state.shaped.has(endpoint)) {
    state.shaped.add(endpoint);
    inspectHandlerShape(endpoint, tools);
    inspectHandlerConstruction(endpoint, state.importedAs, tools);
  }
  const registration = handlerRegistration(node);
  if (!registration) return;
  reportRegistration(registration, tools);
  const handler = resolveHandler(registration.candidate, state.functions);
  if (handler && !state.bounded.has(handler)) {
    state.bounded.add(handler);
    const produced = registration.fluent ? declaredProducerFields(node) : undefined;
    inspectHandlerBoundary({ handler, produced, tools });
  }
}

function honoTypeNames(program) {
  const names = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "hono") continue;
    for (const specifier of statement.specifiers) {
      const imported = importedName(specifier);
      if (specifier.type === "ImportDefaultSpecifier" || imported === "Hono")
        names.add(specifier.local.name);
    }
  }

  return names;
}

function typeReferenceName(annotation) {
  const type = annotation?.typeAnnotation;
  if (type?.type !== "TSTypeReference") return undefined;

  return type.typeName.name ?? type.typeName.right?.name;
}

/** Names holding a Hono app: `const app = new Hono()` or a parameter typed `Hono`. */
function honoReceivers(program, honoTypes) {
  const receivers = new Set();
  walk(program, (node) => {
    const constructed = node.type === "VariableDeclarator" && node.init?.type === "NewExpression";
    if (constructed && honoTypes.has(node.init.callee.name)) receivers.add(node.id.name);
    for (const parameter of node.params ?? []) {
      const pattern = parameterPattern(parameterPattern(parameter));
      const typed =
        pattern?.type === "Identifier" && honoTypes.has(typeReferenceName(pattern.typeAnnotation));
      if (typed) receivers.add(pattern.name);
    }
  });

  return receivers;
}

function reportRawHonoRoutes(program, tools) {
  const honoTypes = honoTypeNames(program);
  const receivers = honoTypes.size > 0 ? honoReceivers(program, honoTypes) : new Set();
  if (receivers.size === 0) return;
  walk(program, (node) => {
    const method = node.type === "CallExpression" ? propertyName(node.callee) : undefined;
    if (RAW_HONO_METHODS.has(method) && receivers.has(node.callee.object.name)) {
      tools.report(node, "rawHonoRoute", { method });
    }
  });
}

function boundaryChecks(program, tools) {
  const state = {
    bounded: new Set(),
    functions: localFunctions(program),
    importedAs: namedImportsOf(program),
    shaped: new Set(),
  };
  walk(program, (node) => {
    reportGenericDispatch(node, tools);
    if (node.type !== "CallExpression") return;
    reportContextCredential(node, tools);
    reportStringPathDispatch(node, tools);
    inspectRouteCall(node, state, tools);
  });
  reportRawHonoRoutes(program, tools);
}

function mergeVisitors(visitorSets) {
  const merged = {};
  for (const visitors of visitorSets) {
    for (const [type, visit] of Object.entries(visitors)) {
      const previous = merged[type];
      merged[type] = previous
        ? (node) => {
            previous(node);
            visit(node);
          }
        : visit;
    }
  }

  return merged;
}

export const transportDeclaresRule = defineRule({
  name: "transport-declares",
  kind: "problem",
  applies: isProcessSource,
  messages: {
    compositionImport: {
      what: "This source imports `@langwatch/api/composition`, which only a process imports.",
      fix: DECLARE_ROUTE_FIX,
    },
    handlerBindingCall: {
      what: "This source calls `createTrpcHandlerBinding`.",
      fix: "Delete the call and export the `defineTrpcRouter` declaration; the process binds handlers when it mounts the router.",
    },
    trpcRoot: {
      what: "This source creates a tRPC root with `{{call}}`.",
      fix: "Declare the procedures with `defineTrpcRouter`; the process owns the one tRPC root and applies each permission after the parser.",
    },
    outputUnchecked: {
      what: "This transport switches output validation off with `{{how}}`.",
      fix: "Declare the response with `.withOutput(schema)` and leave validation on; the framework checks every response against it.",
    },
    rawApp: {
      what: "This source constructs `{{name}}` itself.",
      fix: DECLARE_ROUTE_FIX,
    },
    rawContextField: {
      what: "The handler takes `{{field}}` from its context.",
      fix: HANDLER_FIELDS_FIX,
    },
    rawContextSpread: {
      what: "The handler collects the rest of its context into `{{name}}`.",
      fix: HANDLER_FIELDS_FIX,
    },
    rawContextAccess: {
      what: "The handler reaches the raw request through `{{text}}`.",
      fix: HANDLER_FIELDS_FIX,
    },
    transportHeaders: {
      what: "The handler reads transport headers through `{{text}}`.",
      fix: "Declare what the handler needs with `.withInput(...)`, or read the caller from `actor`; headers are the framework's to resolve.",
    },
    responseMethod: {
      what: "The handler calls the response method `{{name}}()`.",
      fix: PLAIN_RESULT_FIX,
    },
    rawResponse: {
      what: "The handler constructs a raw `Response`.",
      fix: PLAIN_RESULT_FIX,
    },
    responseMutation: {
      what: "The handler sets response state through `{{text}}`.",
      fix: "Declare the status on the route with `.withStatus(...)`; the handler only returns a value or throws.",
    },
    noContentSentinel: {
      what: "The handler returns the `NO_CONTENT` sentinel.",
      fix: "Return nothing: a handler that returns `undefined` answers with an empty response.",
    },
    legacyRegisterRoute: {
      what: "This route registers its handler through `registerRoute`.",
      fix: "Declare it with `defineRestRouter`'s chain so the verb, input, output, permission and inline handler form one declaration.",
    },
    handlerNotInline: {
      what: "This route's handler is not written inline.",
      fix: "Write the handler as an inline function inside `.handle(...)`, beside the route's input, output and permission.",
    },
    handlerConstructs: {
      what: "The handler constructs `{{name}}`.",
      fix: "Call the operation on the handler's `app`; the module constructs its services once, when the process boots.",
    },
    multipleOperationCalls: {
      what: "The handler makes {{count}} calls on `app`.",
      fix: "Call exactly one API operation and move the orchestration into the module; a pure mapping of its result may stay.",
    },
    nestedOperationCall: {
      what: "The handler calls `app` from inside a callback.",
      fix: "Add one operation to the module that does the whole batch, and call it once.",
    },
    handlerControlFlow: {
      what: "The handler branches, loops or catches.",
      fix: "Move the decision into the module behind `app`; the handler calls one operation and returns its result or throws.",
    },
    handlerTooLong: {
      what: "The handler has {{count}} top-level statements; the ceiling is {{max}}.",
      fix: "Keep it to one operation call on `app` and a pure mapping of the result; declare permission and limits on the route.",
    },
    rbacImport: {
      what: "This transport imports the legacy RBAC module `{{specifier}}`.",
      fix: PERMISSION_FIX,
    },
    legacyRbacName: {
      what: "This transport names the legacy RBAC identifier `{{name}}`.",
      fix: PERMISSION_FIX,
    },
    openapiDoorImport: {
      what: "This REST transport imports `{{names}}` from `{{specifier}}`.",
      fix: "Declare the route with `defineRestRouter`: `.withInput(...)` validates the request and `.withDocs(...)` documents it.",
    },
    zodValidatorImport: {
      what: "This REST transport imports `@hono/zod-validator`.",
      fix: "Declare the request shape with `.withInput(schema)` on the route.",
    },
    bareRouter: {
      what: "This tRPC transport builds a bare `router({ … })`.",
      fix: "Declare each procedure with `defineTrpcRouter`, which applies its permission after the parser.",
    },
    trpcInput: {
      what: "This tRPC transport calls `.input(…)` outside the chain.",
      fix: "Declare the procedure's input with `.withInput(schema)` so its permission applies after the input is parsed.",
    },
    rawHonoRoute: {
      what: "This transport registers the raw Hono route `{{method}}()`.",
      fix: DECLARE_ROUTE_FIX,
    },
    credentialFromContext: {
      what: "This transport reads the credential `{{key}}` off the request context.",
      fix: "Read the caller from the handler's `actor` and `scope`; the framework resolves the credential, class and all, before the handler runs.",
    },
    stringDispatch: {
      what: "This transport exposes a generic `{{name}}(path: string, …)` dispatcher.",
      fix: TYPED_DISPATCH_FIX,
    },
    stringPathCall: {
      what: "This transport dispatches through the string path `{{path}}`.",
      fix: TYPED_DISPATCH_FIX,
    },
  },
  create(context, file) {
    const scope = scopeOf(file);
    const tools = createTools(context);
    const state = { declaresTransports: false, imports: undefined, program: undefined };
    const visitorSets = [
      {
        Program(program) {
          state.program = program;
          state.imports = importAnalysis(program);
          state.declaresTransports = declaresTransports(file, state.imports);
          if (scope.boundary) boundaryChecks(program, tools);
          if (scope.surface) frameworkImportChecks(program, scope.surface, tools);
          if (!scope.featureServer) return;
          for (const statement of state.imports.compositionStatements) {
            tools.report(statement, "compositionImport");
          }
        },
      },
    ];
    if (scope.featureServer) visitorSets.push(featureServerVisitors(state, tools));
    if (scope.surface) visitorSets.push(frameworkVisitors(scope.surface, tools));

    return mergeVisitors(visitorSets);
  },
});
