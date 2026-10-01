import { defineRule } from "../define-rule.mjs";

// "Port" is banned: state a module owns is a repository, an exchange with
// something it does not own is a channel, a supplied client is
// Infrastructure, and behaviour is a service. Case-sensitive on PascalCase
// `*Port`, so `transport`, `report`, `import`, and `freePort` are untouched.

const PORT_WORD = /^[A-Z][A-Za-z0-9]*Ports?(?![a-z])/;

const PORT_PATH = /(^|\/)ports?\//;
const PORT_FILE = /\.ports?\.tsx?$/;

function namesAPort(name) {
  return typeof name === "string" && PORT_WORD.test(name);
}

function report(context, node, name) {
  context.report({ node, messageId: "portVocabulary", data: { name } });
}

function isPortSpecifier(source) {
  return typeof source === "string" && (PORT_PATH.test(source) || PORT_FILE.test(source));
}

function reportPortSource(context, node) {
  const source = node.source?.value;
  if (isPortSpecifier(source)) report(context, node, source);
}

function reportPortName(context, node, identifier) {
  if (identifier?.type === "Identifier" && namesAPort(identifier.name)) {
    report(context, node, identifier.name);
  }
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
        "Move it to `repositories/` if it owns state, `channels/` if it exchanges messages with " +
        "something the module does not own, `services/` if it's behaviour, or the module's " +
        "Infrastructure if it's a client the process supplies — then rename the file for that " +
        "role, dropping `port`.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const named = (key) => (node) => reportPortName(context, node, node[key]);
    const sourced = (node) => reportPortSource(context, node);

    return {
      Program(node) {
        if (isPortSpecifier(filename)) {
          context.report({ node, messageId: "portFile", data: { name: filename } });
        }
      },
      ImportDeclaration: sourced,
      ExportNamedDeclaration: sourced,
      ExportAllDeclaration: sourced,
      ImportSpecifier: named("imported"),
      ClassDeclaration: named("id"),
      FunctionDeclaration: named("id"),
      VariableDeclarator: named("id"),
      TSInterfaceDeclaration: named("id"),
      TSTypeAliasDeclaration: named("id"),
      TSEnumDeclaration: named("id"),
      PropertyDefinition: named("key"),
      TSPropertySignature: named("key"),
    };
  },
});
