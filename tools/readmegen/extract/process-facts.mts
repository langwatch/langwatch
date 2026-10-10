// A module's process half read as builder chains, booting nothing: the
// process module declaration, REST families, tRPC procedures joined with their
// contract half, sockets, pipelines with their process managers and
// subscribers, and tasks. Plan: dev/docs/plans/module-readmes-2026-10-06.md §5.3.
import { sourceFile } from "@langwatch/architecture-enforcer";
import ts from "typescript";

import { at, type At, findDeclaration, type Reading, textOf, unwrap } from "./fold.mts";
import {
  callsNamed,
  type Chain,
  fold,
  foldList,
  type Link,
  propertyOf,
  readChain,
  type Scalar,
  scopedDeclaration,
} from "./values.mts";

type Scope = { source: ts.SourceFile; reading: Reading };

export type SchemaRef = { role: string; name: string; inline: boolean; at: At };
export type Gate = { kind: string; detail: string; resolved: boolean };
export type Entitlement = { entitlement: string; feature: string };

export type RestRoute = {
  method: string;
  methods: string[];
  anyMethod: boolean;
  path: Scalar;
  operation: Scalar;
  version: string;
  credential: string;
  gate: Gate;
  entitlement: Entitlement | null;
  hidden: boolean;
  deprecated: boolean;
  summary: string;
  schemas: SchemaRef[];
  at: At;
};
export type RestFamily = {
  name: string;
  namespace: Scalar;
  version: Scalar;
  addressing: string;
  v1Twin: boolean;
  generation: string;
  credential: string;
  deprecated: boolean;
  routes: RestRoute[];
  at: At;
};
export type TrpcProcedure = {
  name: string;
  kind: string;
  gate: Gate;
  entitlement: Entitlement | null;
  input: SchemaRef | null;
  output: SchemaRef | null;
  implemented: boolean;
  at: At;
};
export type TrpcRouter = { namespace: Scalar; contractAt: At; procedures: TrpcProcedure[]; at: At };
export type Socket = { protocol: string; paths: Scalar[]; prefixes: Scalar[]; at: At };
export type Schedule = { everyMs: Scalar; source: string };
export type ProcessManager = {
  name: Scalar;
  schedule: Schedule | null;
  intents: string[];
  outbox: boolean;
  applier: string;
  read: boolean;
  gated: boolean;
  at: At;
};
export type Subscriber = {
  kind: string;
  name: Scalar;
  eventType: Scalar | null;
  publisher: string;
  gated: boolean;
  at: At;
};
export type PipelineItem = { kind: string; name: Scalar; gated: boolean; at: At };
export type Pipeline = {
  name: Scalar;
  aggregate: Scalar;
  events: string[];
  commands: PipelineItem[];
  processManagers: ProcessManager[];
  subscribers: Subscriber[];
  others: PipelineItem[];
  split: string;
  splitAt: At | null;
  at: At;
};
export type Task = { name: Scalar; className: string; at: At };
export type Installation = { text: string; at: At; tasks: Task[] };
export type ProcessFacts = {
  installation: Installation | null;
  rest: RestFamily[];
  trpc: TrpcRouter[];
  sockets: Socket[];
  pipelines: Pipeline[];
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ACCESS_KINDS: Record<string, string> = {
  publicRoute: "public",
  anyAuthenticated: "authenticated",
  optionalCredential: "optional credential",
  deferredScope: "deferred scope",
};
const SCHEMA_ROLES: Record<string, string> = {
  withParams: "params",
  withQuery: "query",
  withInput: "body",
  withRawBody: "raw body",
  withMultipart: "multipart",
  withHeaders: "headers",
  withOutput: "response",
  withResponse: "response",
  withRawResponse: "raw response",
};
const SOCKETS = /^(WebSocketProtocol|RawSocketProtocol|RawHttpProtocol)\.create$/;
const PROTOCOLS: Record<string, string> = {
  WebSocketProtocol: "websocket",
  RawSocketProtocol: "rawsocket",
  RawHttpProtocol: "rawhttp",
};
const SHORT_ARGUMENT = /^[\w."'-]{1,48}$/;

function scalar({
  expression,
  ...scope
}: Scope & { expression: ts.Expression | undefined }): Scalar {
  return expression
    ? fold({ expression, ...scope })
    : { value: "", text: "", resolved: false, file: "" };
}

function stringOf(scope: Scope & { expression: ts.Expression | undefined }): string {
  const folded = scalar(scope);

  return folded.resolved || !folded.text ? folded.value : `≈ ${folded.text}`;
}

const ACCESS_OBJECT_KINDS: Record<string, string> = {
  public: "public",
  authenticated: "authenticated",
  optional: "optional credential",
  deferred: "deferred scope",
};

/** `{ kind, reason }` or `{ kind: "permission", permission, via }` written as an object. */
function objectGate({
  expression,
  ...scope
}: Scope & { expression: ts.Expression }): Gate | undefined {
  const value = unwrap(expression);
  const literal = ts.isObjectLiteralExpression(value) || ts.isIdentifier(value);
  if (!literal || !property({ expression, name: "kind", ...scope })) return void 0;

  const kind = propertyString({ expression, name: "kind", ...scope });
  const via = propertyString({ expression, name: "via", ...scope });
  const listed = property({ expression, name: "permissions", ...scope });
  const permissions =
    listed && ts.isExpression(listed.node)
      ? foldList({ expression: listed.node, source: listed.source, reading: scope.reading }).map(
          (item) => (item.resolved ? item.value : `≈ ${item.text}`),
        )
      : [propertyString({ expression, name: "permission", ...scope })];
  const access = ACCESS_OBJECT_KINDS[kind];
  if (access)
    return {
      kind: access,
      detail: propertyString({ expression, name: "reason", ...scope }),
      resolved: true,
    };
  if (!kind.startsWith("permission")) return void 0;

  const detail = permissions.filter(Boolean).join(" or ") + (via ? `, via ${via}` : "");

  return { kind: "permission", detail, resolved: !detail.includes("≈") };
}

function property({
  expression,
  name,
  ...scope
}: Scope & { expression: ts.Expression | undefined; name: string }) {
  return expression ? propertyOf({ expression, name, ...scope }) : void 0;
}

function propertyString(
  scope: Scope & { expression: ts.Expression | undefined; name: string },
): string {
  const found = property(scope);
  if (!found || !ts.isExpression(found.node)) return "";

  return stringOf({ expression: found.node, source: found.source, reading: scope.reading });
}

function schemaRef({
  role,
  expression,
  ...scope
}: Scope & { role: string; expression: ts.Expression }): SchemaRef {
  const value = unwrap(expression);
  if (!ts.isIdentifier(value))
    return {
      role,
      name: textOf({ node: value, source: scope.source }),
      inline: true,
      at: at({ node: value, ...scope }),
    };

  const found = scopedDeclaration({ name: value.text, from: value, ...scope });
  const where = found
    ? at({ node: found.node, source: found.source, reading: scope.reading })
    : at({ node: value, ...scope });

  return { role, name: value.text, inline: false, at: where };
}

/** A permission, an access kind or a declared exemption, as one gate. */
function gateOf({ link, ...scope }: Scope & { link: Link }): Gate {
  const [first, second] = link.args;
  if (!first) return { kind: "none", detail: "", resolved: true };
  if (link.name === "noPermission" || link.name === "serviceAuthorized") {
    const reason = propertyString({ expression: first, name: "reason", ...scope });
    const permissions = property({ expression: first, name: "permissions", ...scope });
    const listed =
      permissions && ts.isExpression(permissions.node)
        ? foldList({
            expression: permissions.node,
            source: permissions.source,
            reading: scope.reading,
          })
        : [];
    const names = listed.map((item) => (item.resolved ? item.value : item.text)).join(", ");
    const detail = link.name === "serviceAuthorized" && names ? `${names}; ${reason}` : reason;

    return {
      kind: link.name === "noPermission" ? "no permission" : "service-authorized",
      detail,
      resolved: true,
    };
  }
  const written = objectGate({ expression: first, ...scope });
  if (written) return written;
  if (link.name === "withAccess") {
    const named = unwrap(first);
    const declared = ts.isIdentifier(named)
      ? scopedDeclaration({ name: named.text, from: named, ...scope })
      : void 0;
    const viaName = declared && ts.isExpression(declared.node) ? declared : void 0;
    const call = unwrap(viaName ? (viaName.node as ts.Expression) : first);
    const callSource = viaName ? viaName.source : scope.source;
    const inner = { source: callSource, reading: scope.reading };
    const callee = ts.isCallExpression(call) ? call.expression.getText(callSource) : "";
    const reason = ts.isCallExpression(call)
      ? propertyString({ expression: call, name: "reason", ...inner })
      : "";
    const kind = ACCESS_KINDS[callee];

    return kind
      ? { kind, detail: reason, resolved: true }
      : { kind: "access", detail: textOf({ node: first, source: scope.source }), resolved: false };
  }

  const value = unwrap(first);
  const permissions = ts.isArrayLiteralExpression(value)
    ? foldList({ expression: value, ...scope })
    : [scalar({ expression: value, ...scope })];
  const resolved = permissions.every((item) => item.resolved);
  const detail = resolved
    ? permissions.map((item) => item.value).join(" or ")
    : textOf({ node: value, source: scope.source });
  const target = second ? propertyString({ expression: second, name: "at", ...scope }) : "";

  return { kind: target === "platform" ? "platform permission" : "permission", detail, resolved };
}

function entitlementOf({ link, ...scope }: Scope & { link: Link }): Entitlement {
  const [first, options] = link.args;

  return {
    entitlement: stringOf({ expression: first, ...scope }),
    feature: options ? propertyString({ expression: options, name: "feature", ...scope }) : "",
  };
}

function nameOf(link: Link): ts.Node {
  return ts.isPropertyAccessExpression(link.call.expression)
    ? link.call.expression.name
    : link.call;
}

function holderName(call: ts.Node): string {
  for (let node: ts.Node | undefined = call; node; node = node.parent) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
    if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
    if (ts.isSourceFile(node)) break;
  }

  return "";
}

function newRoute({ link, ...scope }: Scope & { link: Link }): RestRoute {
  const [path, operation] = link.args;

  return {
    method: link.name.toUpperCase(),
    methods: [],
    anyMethod: false,
    path: scalar({ expression: path, ...scope }),
    operation: scalar({ expression: operation, ...scope }),
    version: "",
    credential: "",
    gate: { kind: "none", detail: "", resolved: true },
    entitlement: null,
    hidden: false,
    deprecated: false,
    summary: "",
    schemas: [],
    at: at({ node: nameOf(link), ...scope }),
  };
}

function docsInto({ route, link, ...scope }: Scope & { route: RestRoute; link: Link }): void {
  const [docs] = link.args;
  route.hidden =
    propertyString({ expression: docs, name: "hide", ...scope }) === "true" ||
    Boolean(docs && /\bhide:\s*true\b/.test(docs.getText(scope.source)));
  route.summary =
    propertyString({ expression: docs, name: "summary", ...scope }) ||
    propertyString({ expression: docs, name: "description", ...scope });
}

function familyLink({ family, link, ...scope }: Scope & { family: RestFamily; link: Link }): void {
  const [first, options] = link.args;
  if (link.name === "withNamespace") family.namespace = scalar({ expression: first, ...scope });
  if (link.name === "withVersion") family.version = scalar({ expression: first, ...scope });
  if (link.name === "withCredential") family.credential = stringOf({ expression: first, ...scope });
  if (link.name === "withDeprecated") family.deprecated = true;
  if (link.name !== "withAddressing") return;

  family.addressing = stringOf({ expression: first, ...scope });
  const twin = options ? options.getText(scope.source) : "";
  family.v1Twin = !/\bv1Twin:\s*false\b/.test(twin);
  family.generation = propertyString({ expression: options, name: "generation", ...scope }) || "v1";
}

function routeLink({ route, link, ...scope }: Scope & { route: RestRoute; link: Link }): void {
  const [first] = link.args;
  const role = SCHEMA_ROLES[link.name];
  if (role && first) route.schemas.push(schemaRef({ role, expression: first, ...scope }));
  if (link.name === "withPermission" || link.name === "withAccess")
    route.gate = gateOf({ link, ...scope });
  if (link.name === "withEntitlement") route.entitlement = entitlementOf({ link, ...scope });
  if (link.name === "withDocs") docsInto({ route, link, ...scope });
  if (link.name === "withVersion") route.version = stringOf({ expression: first, ...scope });
  if (link.name === "withCredential") route.credential = stringOf({ expression: first, ...scope });
  if (link.name === "withDeprecated") route.deprecated = true;
  if (link.name === "anyMethod") route.anyMethod = true;
  if (link.name === "methods" && first)
    route.methods = foldList({ expression: first, ...scope }).map((item) =>
      (item.resolved ? item.value : item.text).toUpperCase(),
    );
}

function readRest({ root, ...scope }: Scope & { root: ts.CallExpression }): RestFamily {
  const empty = { value: "", text: "", resolved: false, file: "" };
  const family: RestFamily = {
    name: holderName(root),
    namespace: empty,
    version: empty,
    addressing: "dated",
    v1Twin: true,
    generation: "v1",
    credential: "project",
    deprecated: false,
    routes: [],
    at: at({ node: root, ...scope }),
  };
  let route: RestRoute | undefined;
  for (const link of readChain({ root, ...scope }).links.slice(1)) {
    if (HTTP_METHODS.has(link.name) && link.args.length >= 2) {
      route = newRoute({ link, ...scope });
      family.routes.push(route);
    } else if (route) routeLink({ route, link, ...scope });
    else familyLink({ family, link, ...scope });
  }

  return family;
}

function contractOf({ expression, ...scope }: Scope & { expression: ts.Expression | undefined }) {
  const value = expression ? unwrap(expression) : void 0;
  const found =
    value && ts.isIdentifier(value)
      ? scopedDeclaration({ name: value.text, from: value, ...scope })
      : void 0;
  if (!found) return void 0;

  const [root] = callsNamed({ source: found.source, callee: /^defineTrpcContract$/ }).filter(
    (call) => call.pos >= found.node.pos && call.end <= found.node.end,
  );

  return root ? { root, source: found.source } : void 0;
}

function readContract({ root, ...scope }: Scope & { root: ts.CallExpression }) {
  const procedures: TrpcProcedure[] = [];
  let current: TrpcProcedure | undefined;
  for (const link of readChain({ root, ...scope }).links.slice(1)) {
    const [first] = link.args;
    if (["query", "mutation", "subscription"].includes(link.name)) {
      current = {
        name: stringOf({ expression: first, ...scope }),
        kind: link.name,
        gate: { kind: "none", detail: "", resolved: false },
        entitlement: null,
        input: null,
        output: null,
        implemented: false,
        at: at({ node: nameOf(link), ...scope }),
      };
      procedures.push(current);
    }
    if (current && first && link.name === "withInput")
      current.input = schemaRef({ role: "input", expression: first, ...scope });
    if (current && first && link.name === "withOutput")
      current.output = schemaRef({ role: "output", expression: first, ...scope });
  }

  return {
    namespace: scalar({ expression: root.arguments[0], ...scope }),
    procedures,
    at: at({ node: root, ...scope }),
  };
}

function readTrpc({ root, ...scope }: Scope & { root: ts.CallExpression }): TrpcRouter {
  const contract = contractOf({ expression: root.arguments[1], ...scope });
  const read = contract
    ? readContract({ root: contract.root, source: contract.source, reading: scope.reading })
    : {
        namespace: scalar({ expression: root.arguments[1], ...scope }),
        procedures: [],
        at: at({ node: root, ...scope }),
      };
  let current: TrpcProcedure | undefined;
  for (const link of readChain({ root, ...scope }).links.slice(1)) {
    if (link.name === "procedure") {
      const name = stringOf({ expression: link.args[0], ...scope });
      current = read.procedures.find((item) => item.name === name);
      if (!current) {
        current = {
          name,
          kind: "≈",
          gate: { kind: "none", detail: "", resolved: false },
          entitlement: null,
          input: null,
          output: null,
          implemented: false,
          at: at({ node: nameOf(link), ...scope }),
        };
        read.procedures.push(current);
      }
      current.implemented = true;
      current.at = at({ node: nameOf(link), ...scope });
    } else if (
      current &&
      ["withPermission", "withAccess", "noPermission", "serviceAuthorized"].includes(link.name)
    ) {
      current.gate = gateOf({ link, ...scope });
    } else if (current && link.name === "withEntitlement")
      current.entitlement = entitlementOf({ link, ...scope });
  }

  return {
    namespace: read.namespace,
    contractAt: read.at,
    procedures: read.procedures,
    at: at({ node: root, ...scope }),
  };
}

function readSocket({ root, ...scope }: Scope & { root: ts.CallExpression }): Socket {
  const [options] = root.arguments;
  const listed = (name: string): Scalar[] => {
    const found = property({ expression: options, name, ...scope });
    if (!found || !ts.isExpression(found.node)) return [];

    return foldList({ expression: found.node, source: found.source, reading: scope.reading });
  };
  const protocol = PROTOCOLS[root.expression.getText(scope.source).split(".")[0] ?? ""] ?? "";

  return {
    protocol,
    paths: [...listed("path"), ...listed("paths")],
    prefixes: listed("prefixes"),
    at: at({ node: root, ...scope }),
  };
}

/** The node an applier's `.schedule(...)` and `.intent(...)` calls live in. */
function applierBody({
  expression,
  ...scope
}: Scope & { expression: ts.Expression }): { node: ts.Node; source: ts.SourceFile } | undefined {
  const value = unwrap(expression);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
    return { node: value, source: scope.source };

  const callee = ts.isCallExpression(value) ? unwrap(value.expression) : value;
  if (!ts.isIdentifier(callee)) return void 0;

  const found = scopedDeclaration({ name: callee.text, from: callee, ...scope });

  return found ? { node: found.node, source: found.source } : void 0;
}

function scheduleOf({ call, ...scope }: Scope & { call: ts.CallExpression }): Schedule | null {
  const every = property({ expression: call.arguments[0], name: "everyMs", ...scope });
  if (!every || !ts.isExpression(every.node)) return null;

  const folded = fold({ expression: every.node, source: every.source, reading: scope.reading });
  const value = unwrap(every.node);
  const declared = ts.isIdentifier(value)
    ? scopedDeclaration({
        name: value.text,
        from: value,
        source: every.source,
        reading: scope.reading,
      })
    : void 0;
  const source =
    declared && ts.isExpression(declared.node) && !ts.isNumericLiteral(declared.node)
      ? `${value.getText(every.source)} = ${textOf({ node: declared.node, source: declared.source })}`
      : ts.isIdentifier(value)
        ? value.text
        : "";

  return { everyMs: folded, source };
}

function readProcessManager({
  link,
  gated,
  ...scope
}: Scope & { link: Link; gated: boolean }): ProcessManager {
  const [first, second] = link.args;
  const definition = second ? void 0 : first;
  const name = definition
    ? scalar({
        expression: property({ expression: definition, name: "name", ...scope })?.node as
          | ts.Expression
          | undefined,
        ...scope,
      })
    : scalar({ expression: first, ...scope });
  const manager: ProcessManager = {
    name,
    schedule: null,
    intents: [],
    outbox: false,
    applier: "",
    read: false,
    gated,
    at: at({ node: nameOf(link), ...scope }),
  };
  const applier = second ?? first;
  const body = applier ? applierBody({ expression: applier, ...scope }) : void 0;
  manager.applier = applier ? textOf({ node: applier, source: scope.source }) : "";
  if (!body) return manager;

  manager.read = true;
  const visit = (node: ts.Node): void => {
    const access =
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        ? node.expression
        : void 0;
    const call = node as ts.CallExpression;
    const inner = { source: body.source, reading: scope.reading };
    if (access?.name.text === "schedule") manager.schedule = scheduleOf({ call, ...inner });
    if (access?.name.text === "intent" && call.arguments[0])
      manager.intents.push(stringOf({ expression: call.arguments[0], ...inner }));
    if (access?.name.text === "outbox") manager.outbox = true;
    ts.forEachChild(node, visit);
  };
  visit(body.node);

  return manager;
}

function readSubscriber({
  link,
  gated,
  moduleOfFile,
  ...scope
}: Scope & { link: Link; gated: boolean; moduleOfFile: (file: string) => string }): Subscriber {
  const [first, definition] = link.args;
  const event =
    property({ expression: definition, name: "eventType", ...scope }) ??
    property({ expression: definition, name: "events", ...scope });
  const listed =
    event && ts.isExpression(event.node)
      ? foldList({ expression: event.node, source: event.source, reading: scope.reading })
      : [];
  const eventType: Scalar | null =
    listed.length === 0
      ? null
      : {
          value: listed.map((item) => item.value).join(", "),
          text: listed.map((item) => item.text).join(", "),
          resolved: listed.every((item) => item.resolved),
          file: listed[0]?.file ?? "",
        };

  return {
    kind: link.name === "withPeerSubscriber" ? "peer subscriber" : "subscriber",
    name: scalar({ expression: first, ...scope }),
    eventType,
    publisher: eventType?.resolved ? moduleOfFile(eventType.file) : "",
    gated,
    at: at({ node: nameOf(link), ...scope }),
  };
}

function item({
  link,
  gated,
  kind,
  ...scope
}: Scope & { link: Link; gated: boolean; kind: string }): PipelineItem {
  const [first] = link.args;
  const name =
    first && !ts.isObjectLiteralExpression(unwrap(first))
      ? scalar({ expression: first, ...scope })
      : { value: "", text: "", resolved: true, file: "" };

  return { kind, name, gated, at: at({ node: nameOf(link), ...scope }) };
}

function readPipeline({
  root,
  moduleOfFile,
  ...scope
}: Scope & { root: ts.CallExpression; moduleOfFile: (file: string) => string }): Pipeline {
  const [options] = root.arguments;
  const aggregate = property({ expression: options, name: "aggregate", ...scope });
  const aggregateType =
    aggregate && ts.isExpression(aggregate.node)
      ? property({
          expression: aggregate.node,
          name: "type",
          source: aggregate.source,
          reading: scope.reading,
        })
      : void 0;
  const chain: Chain = readChain({ root, ...scope });
  const pipeline: Pipeline = {
    name: scalar({
      expression: property({ expression: options, name: "name", ...scope })?.node as
        | ts.Expression
        | undefined,
      ...scope,
    }),
    aggregate:
      aggregateType && ts.isExpression(aggregateType.node)
        ? fold({
            expression: aggregateType.node,
            source: aggregateType.source,
            reading: scope.reading,
          })
        : { value: "", text: "", resolved: false, file: "" },
    events: [],
    commands: [],
    processManagers: [],
    subscribers: [],
    others: [],
    split: chain.split,
    splitAt: chain.splitAt ?? null,
    at: at({ node: root, ...scope }),
  };
  for (const link of chain.links.slice(1)) {
    const [first] = link.args;
    const step = { link, gated: link.gated, ...scope };
    if (link.name === "withEvents" && first) {
      const value = unwrap(first);
      const elements = ts.isArrayLiteralExpression(value) ? value.elements : [value];
      pipeline.events.push(...elements.map((node) => textOf({ node, source: scope.source })));
    } else if (link.name === "withCommand" || link.name === "withCommandInstance")
      pipeline.commands.push(item({ ...step, kind: "command" }));
    else if (link.name === "withProcessManager")
      pipeline.processManagers.push(readProcessManager(step));
    else if (link.name === "withPeerSubscriber" || link.name === "withEventSubscriber")
      pipeline.subscribers.push(readSubscriber({ ...step, moduleOfFile }));
    else if (link.name.startsWith("with"))
      pipeline.others.push(item({ ...step, kind: link.name.slice(4) }));
  }

  return pipeline;
}

function taskOf({ name, ...scope }: Scope & { name: string }): Task | undefined {
  const found = findDeclaration({ name, ...scope });
  if (!found || !ts.isClassDeclaration(found.node)) return void 0;

  const member = found.node.members.find(
    (node) => ts.isPropertyDeclaration(node) && node.name.getText(found.source) === "name",
  ) as ts.PropertyDeclaration | undefined;
  if (!member?.initializer) return void 0;
  const inner = { source: found.source, reading: scope.reading };

  return {
    name: scalar({ expression: member.initializer, ...inner }),
    className: name,
    at: at({ node: found.node, ...inner }),
  };
}

function argumentText({ node, source }: { node: ts.Expression; source: ts.SourceFile }): string {
  const text = node.getText(source);

  return SHORT_ARGUMENT.test(text) ? text : "…";
}

function readInstallation({ root, ...scope }: Scope & { root: ts.CallExpression }): Installation {
  const tasks: Task[] = [];
  const parts: string[] = [];
  for (const link of readChain({ root, ...scope }).links) {
    parts.push(
      `${link.name}(${link.args.map((node) => argumentText({ node, source: scope.source })).join(", ")})`,
    );
    if (link.name !== "withTasks") continue;

    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
      const access =
        ts.isPropertyAccessExpression(node) && node.name.text === "create"
          ? node.expression
          : void 0;
      const created = ts.isNewExpression(node) ? node.expression : access;
      if (created && ts.isIdentifier(created)) names.add(created.text);
      ts.forEachChild(node, visit);
    };
    for (const node of link.args) visit(node);
    for (const name of names) {
      const task = taskOf({ name, ...scope });
      if (task) tasks.push(task);
    }
  }

  return { text: parts.join("."), at: at({ node: root, ...scope }), tasks };
}

/** Every process-half fact, read from the half's own source files. */
export function readProcess({
  files,
  reading,
  moduleOfFile,
}: {
  files: string[];
  reading: Reading;
  moduleOfFile: (file: string) => string;
}): ProcessFacts {
  const facts: ProcessFacts = {
    installation: null,
    rest: [],
    trpc: [],
    sockets: [],
    pipelines: [],
  };
  for (const file of files) {
    const source = sourceFile({ file });
    const text = source.text;
    const scope = { source, reading };
    if (text.includes("defineProcessModule("))
      for (const root of callsNamed({ source, callee: /^defineProcessModule$/ }))
        facts.installation ??= readInstallation({ root, ...scope });
    if (text.includes("defineRestRouter("))
      for (const root of callsNamed({ source, callee: /^defineRestRouter$/ }))
        facts.rest.push(readRest({ root, ...scope }));
    if (text.includes("defineTrpcRouter("))
      for (const root of callsNamed({ source, callee: /^defineTrpcRouter$/ }))
        facts.trpc.push(readTrpc({ root, ...scope }));
    if (/Protocol\.create\(/.test(text))
      for (const root of callsNamed({ source, callee: SOCKETS }))
        facts.sockets.push(readSocket({ root, ...scope }));
    if (text.includes("definePipeline("))
      for (const root of callsNamed({ source, callee: /^definePipeline$/ }))
        facts.pipelines.push(readPipeline({ root, moduleOfFile, ...scope }));
  }

  return facts;
}
