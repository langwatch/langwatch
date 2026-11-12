import { defineRule } from "../define-rule.mjs";

// ADR-201 §9: braids reach the ClickHouse fence only on a proof the trace module's plan check
// honoured, so a new read that skips the check fails closed rather than showing braids.

const HONOUR = "honourSpanBraids";
const FLAG = "braidsHonoured";
export const BRAID_HONOUR_OWNER =
  "modules/trace/process/src/features/read/services/trace-braid-pause.service.ts";
const AUTHORIZATION_PACKAGE = "packages/authorization/";

function nameOf(node) {
  if (node?.type === "Identifier") return node.name;
  return typeof node?.value === "string" ? node.value : undefined;
}

function isFlagProperty(property) {
  return property.type === "Property" && !property.computed && nameOf(property.key) === FLAG;
}

export const spanBraidHonourOwnerRule = defineRule({
  name: "span-braid-honour-owner",
  kind: "problem",
  applies: (file) => file.isProduction && !file.workspacePath.startsWith(AUTHORIZATION_PACKAGE),
  messages: {
    honourOutsidePause: {
      what: "`{{name}}` is used in `{{path}}`, outside the trace module's braid pause.",
      why: "Braids show only on Enterprise; honouring them anywhere else skips that plan check.",
      fix: "Pass the proof through `TraceApi.authorizationForTrace`, which asks the plan before it honours braids.",
    },
    flagByHand: {
      what: "`{{path}}` writes `{{name}}` on an object by hand.",
      why: "Only `honourSpanBraids` may set the flag, after the plan check; a hand-set flag shows braids below Enterprise.",
      fix: "Drop the key and pass the proof through `TraceApi.authorizationForTrace`.",
    },
  },
  create(context, file) {
    const report = (node, messageId, name) =>
      context.report({ node, messageId, data: { name, path: file.workspacePath } });
    const ownsHonour = file.workspacePath === BRAID_HONOUR_OWNER;
    const namespaces = new Set();

    return {
      ImportSpecifier(node) {
        if (!ownsHonour && nameOf(node.imported) === HONOUR) {
          report(node, "honourOutsidePause", HONOUR);
        }
      },
      ImportNamespaceSpecifier(node) {
        namespaces.add(node.local.name);
      },
      MemberExpression(node) {
        if (ownsHonour || node.computed || !namespaces.has(nameOf(node.object))) return;
        if (nameOf(node.property) === HONOUR) report(node, "honourOutsidePause", HONOUR);
      },
      ObjectExpression(node) {
        const flag = node.properties.find(isFlagProperty);
        if (flag !== undefined) report(flag, "flagByHand", FLAG);
      },
    };
  },
});
