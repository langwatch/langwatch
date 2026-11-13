import { defineRule } from "../define-rule.mjs";

// One S3 region rule for every client (specs/tooling/lint-s3-client-region.feature):
// a client that picks its own region once sent "auto" to AWS, which refuses it.

const AWS_CLIENT_PACKAGE = "packages/aws-client/";
const SHARED_RULE = "s3RegionOf";
const MAX_DEPTH = 8;

function isSharedRuleCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === SHARED_RULE
  );
}

/** `aws.build(options)` or `this.#aws.build(options)`: the @langwatch/aws-client transport. */
function isTransportBuild(node) {
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.name !== "build" || node.arguments.length === 0) return false;
  const owner = callee.object;
  const name = owner.type === "MemberExpression" ? owner.property.name : owner.name;
  return name === "aws";
}

function propertyName(property) {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" ? String(property.key.value) : undefined;
}

function variableOf(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  return scope?.set.get(identifier.name);
}

/** The initialiser of the `const` this identifier resolves to in its own scope. */
function constInitOf(context, identifier) {
  const definition = variableOf(context, identifier)?.defs[0];
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const") return undefined;
  return definition.node.init ?? undefined;
}

/** `options.region = x`, `delete options.region` or `options.n++`: the initialiser is stale. */
function isWrittenThrough(context, identifier) {
  return (variableOf(context, identifier)?.references ?? []).some(({ identifier: used }) => {
    const member = used.parent;
    if (member?.type !== "MemberExpression" || member.object !== used) return false;
    const { parent } = member;
    if (parent?.type === "AssignmentExpression") return parent.left === member;
    if (parent?.type === "UnaryExpression") return parent.operator === "delete";
    return parent?.type === "UpdateExpression";
  });
}

const NO_OPTIONS = { regions: [], always: false, unreadable: undefined };

/** Either path may run: a region counts only when both supply one. */
function eitherPath(first, second) {
  return {
    regions: [...first.regions, ...second.regions],
    always: first.always && second.always,
    unreadable: first.unreadable ?? second.unreadable,
  };
}

function objectOptions(context, node, depth) {
  const result = { regions: [], always: false, unreadable: undefined };
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      const spread = optionsOf(context, property.argument, depth + 1);
      result.regions.push(...spread.regions);
      result.always ||= spread.always;
      result.unreadable ??= spread.unreadable;
    } else if (propertyName(property) === "region") {
      // A later region replaces every earlier one, spread or not.
      result.regions = [property.value];
      result.always = true;
    }
  }
  return result;
}

const READERS = {
  ObjectExpression: objectOptions,
  ConditionalExpression: (context, node, depth) =>
    eitherPath(
      optionsOf(context, node.consequent, depth + 1),
      optionsOf(context, node.alternate, depth + 1),
    ),
  LogicalExpression: (context, node, depth) => {
    const right = optionsOf(context, node.right, depth + 1);
    if (node.operator === "&&") return { ...right, always: false };
    return eitherPath(optionsOf(context, node.left, depth + 1), right);
  },
  // Only the AWS transport's build(options) is known to pass the region on; any other call
  // may replace it, so its result is unreadable.
  CallExpression: (context, node, depth) =>
    isTransportBuild(node)
      ? optionsOf(context, node.arguments[0], depth + 1)
      : { ...NO_OPTIONS, unreadable: node },
  Identifier: (context, node, depth) => {
    const init = constInitOf(context, node);
    if (!init || isWrittenThrough(context, node)) return { ...NO_OPTIONS, unreadable: node };
    return optionsOf(context, init, depth + 1);
  },
};

/** Every `region` the options may carry, whether every path has one, and what was unreadable. */
function optionsOf(context, node, depth = 0) {
  const read = depth <= MAX_DEPTH ? READERS[node?.type] : undefined;
  return read ? read(context, node, depth) : { ...NO_OPTIONS, unreadable: node };
}

function isSharedRegion(context, value) {
  if (isSharedRuleCall(value)) return true;
  return value.type === "Identifier" && isSharedRuleCall(constInitOf(context, value));
}

/** Reports a path with no region, unreadable options, or a region not from the shared rule. */
function reportClient(context, client) {
  const options = client.arguments[0];
  const { regions, always, unreadable } = options ? optionsOf(context, options) : NO_OPTIONS;
  if (!always) {
    const messageId = unreadable ? "unreadableOptions" : "missingRegion";
    context.report({ node: unreadable ?? client, messageId });
  }
  for (const value of regions) {
    if (!isSharedRegion(context, value))
      context.report({ node: value, messageId: "regionNotShared" });
  }
}

export const s3ClientRegionRule = defineRule({
  name: "s3-client-region",
  kind: "problem",
  applies: (file) => file.isProduction && !file.workspacePath.startsWith(AWS_CLIENT_PACKAGE),
  messages: {
    regionNotShared: {
      what: "This `new S3Client` takes its region from somewhere other than `s3RegionOf`.",
      why: "A hand-picked region drifts per client; one sent `auto` to AWS, which refuses to sign with it.",
      fix: "Pass `region: s3RegionOf({ region, endpoint })` from `@langwatch/aws-client`, or a `const` bound to that call. See the `platform-primitives` skill.",
    },
    missingRegion: {
      what: "This `new S3Client` names no region on at least one path.",
      why: "With no region the SDK guesses from the process environment, not from the configured endpoint.",
      fix: "Pass `region: s3RegionOf({ region, endpoint })` from `@langwatch/aws-client` on every path. See the `platform-primitives` skill.",
    },
    unreadableOptions: {
      what: "This `new S3Client` gets options the rule cannot read, so it cannot see their region.",
      why: "A region hidden behind a parameter or a mutable binding escapes the one shared region rule.",
      fix: "Build the options inline or in a `const` here, with `region: s3RegionOf({ region, endpoint })`. See the `platform-primitives` skill.",
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "S3Client") {
          reportClient(context, node);
        }
      },
    };
  },
});
