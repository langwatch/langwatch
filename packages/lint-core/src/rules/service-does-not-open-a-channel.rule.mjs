import { defineRule } from "../define-rule.mjs";

// A collaborator the module does not own is a channel, not a service member.
// A service that opens the bus, pub/sub, a vendor over HTTP, a queue, email
// or Slack has no seam a test can stand in for, and no name for the message
// it is really sending.

const CONDUIT_SPECIFIER = [
  { match: /^@langwatch\/eventing(?:\/|$)/, conduit: "the event bus" },
  { match: /^ioredis(?:\/|$)/, conduit: "Redis pub/sub" },
  { match: /^(?:undici|axios|got|node-fetch)(?:\/|$)/, conduit: "an HTTP client" },
  { match: /^node:https?$/, conduit: "an HTTP client" },
  { match: /^@aws-sdk\//, conduit: "an AWS client" },
  { match: /^(?:resend|nodemailer)(?:\/|$)/, conduit: "a mail sender" },
  { match: /^@slack\//, conduit: "Slack" },
];

function conduitFor(specifier) {
  return CONDUIT_SPECIFIER.find((entry) => entry.match.test(specifier))?.conduit;
}

function isService(file) {
  return (
    file.role === "server" &&
    file.isProduction &&
    Boolean(file.sourcePath?.startsWith("services/"))
  );
}

export const serviceDoesNotOpenAChannelRule = defineRule({
  name: "service-does-not-open-a-channel",
  kind: "problem",
  messages: {
    serviceOpensAChannel: {
      what: "A service opens {{conduit}} directly (`{{specifier}}`).",
      why: "Messages to or from something the module does not own are a channel: an interface the module names, a live implementation per tier and a memory twin a test asserts against.",
      fix: "Move the conduit to `channels/<tier>/<tier>.<subject>.channel.ts` and inject the channel interface.",
    },
  },
  applies: isService,
  create(context) {
    const report = (node, conduit, specifier) =>
      context.report({ node, messageId: "serviceOpensAChannel", data: { conduit, specifier } });

    return {
      ImportDeclaration(node) {
        const specifier = node.source?.value;
        if (typeof specifier !== "string") return;
        if (node.importKind === "type") return;

        const conduit = conduitFor(specifier);
        if (conduit) report(node, conduit, specifier);
      },
      CallExpression(node) {
        if (node.callee?.type === "Identifier" && node.callee.name === "fetch") {
          report(node, "an HTTP client", "fetch");
        }
      },
    };
  },
});
