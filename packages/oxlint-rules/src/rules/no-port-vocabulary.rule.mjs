import { defineRule } from "../define-rule.mjs";

// "Port" is not a word this codebase uses any more. State a module owns lives
// behind a repository, messages it exchanges with something it does not own go
// through a channel, technical clients the process supplies are members of the
// module's Infrastructure, and behaviour lives in a service. A name ending in
// `Port`, a file called `*.port.ts` and a `ports/` folder are all the older
// shape, and the baseline for this rule may only shrink: nothing new may carry
// the word.
//
// The match is deliberately case sensitive on `Port` and only fires on a
// PascalCase name, so `transport`, `report`, `support`, `import`, `export`, a
// network `PORT` and a real network port variable such as `freePort` are all
// left alone. What is left is the abstraction: `UiRpcPort`, `DatasetStoragePort`.

const PORT_WORD = /^[A-Z][A-Za-z0-9]*Ports?(?![a-z])/;

const PORT_PATH = /(^|\/)ports?\//;
const PORT_FILE = /\.ports?\.tsx?$/;

function namesAPort(name) {
  return typeof name === "string" && PORT_WORD.test(name);
}

function report(context, node, name) {
  context.report({ node, messageId: "portVocabulary", data: { name } });
}

export const noPortVocabularyRule = defineRule({
  name: "no-port-vocabulary",
  kind: "problem",
  messages: {
    portVocabulary: {
      what: "`{{name}}` names a port.",
      fix:
        "Name the role instead. Owned state is a repository, messages to something the module " +
        "does not own are a channel, a client the process supplies is a member of the module's " +
        "Infrastructure, behaviour is a service.",
    },
    portFile: {
      what: "`{{name}}` is a port file.",
      fix:
        "Move it to repositories/, channels/, services/ or the module's Infrastructure and " +
        "give it the name of its role.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";

    return {
      Program(node) {
        if (PORT_FILE.test(filename) || PORT_PATH.test(filename)) {
          context.report({ node, messageId: "portFile", data: { name: filename } });
        }
      },
      ImportDeclaration(node) {
        const source = typeof node.source.value === "string" ? node.source.value : "";
        if (PORT_PATH.test(source) || PORT_FILE.test(source)) {
          report(context, node, source);
        }
      },
      ExportNamedDeclaration(node) {
        const source = node.source && typeof node.source.value === "string" ? node.source.value : "";
        if (source && (PORT_PATH.test(source) || PORT_FILE.test(source))) {
          report(context, node, source);
        }
      },
      ExportAllDeclaration(node) {
        const source = typeof node.source?.value === "string" ? node.source.value : "";
        if (source && (PORT_PATH.test(source) || PORT_FILE.test(source))) {
          report(context, node, source);
        }
      },
      ImportSpecifier(node) {
        const name = node.imported.type === "Identifier" ? node.imported.name : undefined;
        if (namesAPort(name)) report(context, node, name);
      },
      ClassDeclaration(node) {
        if (node.id && namesAPort(node.id.name)) report(context, node, node.id.name);
      },
      FunctionDeclaration(node) {
        if (node.id && namesAPort(node.id.name)) report(context, node, node.id.name);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && namesAPort(node.id.name)) {
          report(context, node, node.id.name);
        }
      },
      TSInterfaceDeclaration(node) {
        if (namesAPort(node.id.name)) report(context, node, node.id.name);
      },
      TSTypeAliasDeclaration(node) {
        if (namesAPort(node.id.name)) report(context, node, node.id.name);
      },
      TSEnumDeclaration(node) {
        if (node.id && namesAPort(node.id.name)) report(context, node, node.id.name);
      },
      PropertyDefinition(node) {
        if (node.key.type === "Identifier" && namesAPort(node.key.name)) {
          report(context, node, node.key.name);
        }
      },
      TSPropertySignature(node) {
        if (node.key.type === "Identifier" && namesAPort(node.key.name)) {
          report(context, node, node.key.name);
        }
      },
    };
  },
});
