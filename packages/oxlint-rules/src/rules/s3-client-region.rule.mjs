import { defineRule } from "../define-rule.mjs";

// One S3 region rule for every client (specs/tooling/lint-s3-client-region.feature):
// a client that picks its own region once sent "auto" to AWS, which refuses it.

const AWS_CLIENT_PACKAGE = "packages/aws-client/";
const SHARED_RULE = "s3RegionOf";

function isSharedRuleCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === SHARED_RULE
  );
}

function propertyName(property) {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" ? String(property.key.value) : undefined;
}

/** Every `region` value in the options, through spreads of calls and conditionals. */
function regionValuesOf(node, found = []) {
  if (node?.type === "ConditionalExpression") {
    regionValuesOf(node.consequent, found);
    regionValuesOf(node.alternate, found);
  } else if (node?.type === "CallExpression") {
    regionValuesOf(node.arguments[0], found);
  } else if (node?.type === "ObjectExpression") {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") regionValuesOf(property.argument, found);
      else if (propertyName(property) === "region") found.push(property.value);
    }
  }
  return found;
}

function isSharedRegion(value, sharedNames) {
  if (isSharedRuleCall(value)) return true;
  return value.type === "Identifier" && sharedNames.has(value.name);
}

/** Reports one client: no region at all, or each region not taken from the shared rule. */
function reportClient({ context, client, sharedNames }) {
  const values = regionValuesOf(client.arguments[0]);
  if (values.length === 0) {
    context.report({ node: client, messageId: "missingRegion" });
    return;
  }
  for (const value of values) {
    if (!isSharedRegion(value, sharedNames)) {
      context.report({ node: value, messageId: "regionNotShared" });
    }
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
      fix: "Pass `region: s3RegionOf({ region, endpoint })` from `@langwatch/aws-client`, or a name bound to that call.",
    },
    missingRegion: {
      what: "This `new S3Client` names no region.",
      why: "With no region the SDK guesses from the process environment, not from the configured endpoint.",
      fix: "Pass `region: s3RegionOf({ region, endpoint })` from `@langwatch/aws-client`.",
    },
  },
  create(context) {
    const sharedNames = new Set();
    const clients = [];

    return {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && isSharedRuleCall(node.init)) {
          sharedNames.add(node.id.name);
        }
      },
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "S3Client") return;
        if (node.arguments[0]?.type === "ObjectExpression") clients.push(node);
      },
      "Program:exit"() {
        for (const client of clients) reportClient({ context, client, sharedNames });
      },
    };
  },
});
