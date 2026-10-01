import { isGovernedLayer, layerCrossing, targetLayer } from "../../grammar/module-layers.mjs";
import { defineRule } from "../define-rule.mjs";

// One rule over the layer tables in grammar/module-layers.mjs: the message id
// is the importing layer's, so each carries the fix that layer can apply.

const MESSAGE_FOR_LAYER = {
  channels: "channelCrossing",
  repositories: "repositoryCrossing",
  services: "serviceNamesABackend",
  transport: "transportCrossing",
};

/** A service's message follows what it named: a repository backend or a channel implementation. */
const SERVICE_MESSAGE_FOR_TARGET = {
  channels: "serviceNamesAChannelImplementation",
  repositories: "serviceNamesABackend",
};

function messageIdFor({ layer, sourcePath, specifier }) {
  if (layer !== "services") return MESSAGE_FOR_LAYER[layer];

  return SERVICE_MESSAGE_FOR_TARGET[targetLayer({ sourcePath, specifier })];
}

function isLayeredSource(file) {
  return file.role === "process" && !file.isTest && isGovernedLayer(file.layer);
}

function sourceOf(node) {
  const value = node.source?.value;

  return typeof value === "string" ? value : undefined;
}

/** Whether the node binds only types, so nothing of the target runs here. */
function isTypeOnly(node) {
  if (node.type === "ImportExpression") return false;
  if (node.importKind === "type" || node.exportKind === "type") return true;
  const bindings = node.specifiers ?? [];
  if (bindings.length === 0) return false;

  return bindings.every(
    (binding) => binding.importKind === "type" || binding.exportKind === "type",
  );
}

export const moduleLayersRule = defineRule({
  name: "module-layers",
  kind: "problem",
  applies: isLayeredSource,
  messages: {
    repositoryCrossing: {
      what: "A repository names {{crossed}} (`{{specifier}}`).",
      why: "A repository takes the store it reads; behaviour lives in the services above it.",
      fix: "Move the decision into the service that calls this repository and keep the repository over its store alone.",
    },
    channelCrossing: {
      what: "A channel names {{crossed}} (`{{specifier}}`).",
      why: "A channel takes the client it speaks to; state is the repository's and behaviour the service's.",
      fix: "Move the call into the service that owns the decision and have that service invoke this channel.",
    },
    transportCrossing: {
      what: "A transport names {{crossed}} (`{{specifier}}`).",
      why: "A transport declares; the module behind `app` owns the state, the guards and the tenancy filter.",
      fix: "Call the operation on the `app` the handler receives.",
    },
    serviceNamesABackend: {
      what: "A service names {{crossed}} (`{{specifier}}`).",
      why: "A service works over repository interfaces; the registry chooses the backend.",
      fix: "Import the `repositories/<subject>.repository.ts` interface instead and take the implementation from the module's repository registry.",
    },
    serviceNamesAChannelImplementation: {
      what: "A service names {{crossed}} (`{{specifier}}`).",
      why: "A service works over channel interfaces; the channel registry chooses the tier.",
      fix: "Import the `channels/<subject>.channel.ts` interface instead and take the implementation from the module's channel registry.",
    },
  },
  create(context, file) {
    const check = (node) => {
      const specifier = sourceOf(node);
      if (!specifier) return;

      const crossed = layerCrossing({
        layer: file.layer,
        sourcePath: file.sourcePath,
        specifier,
        typeOnly: isTypeOnly(node),
      });
      if (!crossed) return;

      context.report({
        node,
        messageId: messageIdFor({ layer: file.layer, sourcePath: file.sourcePath, specifier }),
        data: { crossed, specifier },
      });
    };

    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportDeclaration: check,
      ImportExpression: check,
    };
  },
});
