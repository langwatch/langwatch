import { defineRule } from "../define-rule.mjs";

// A collaborator the module does not own is a channel, not a service member.
// A service that opens the bus, pub/sub, a vendor over HTTP, a queue, email
// or Slack has no seam a test can stand in for, and no name for the message
// it is really sending.

// `tier` names the `channels/<tier>/` folder the implementation belongs in
// (see CHANNEL_TIERS in feature-layout-policy.mjs). Fixed per conduit except
// AWS, where the same package covers several services and `tier` is read off
// the specifier itself, falling back to a literal `<tier>` placeholder only
// when even that can't tell SES from SQS from an untiered service like S3.
const CONDUIT_SPECIFIER = [
  { match: /^@langwatch\/eventing(?:\/|$)/, conduit: "the event bus", tier: "eventing" },
  { match: /^ioredis(?:\/|$)/, conduit: "Redis pub/sub", tier: "redis" },
  { match: /^(?:undici|axios|got|node-fetch)(?:\/|$)/, conduit: "an HTTP client", tier: "http" },
  { match: /^node:https?$/, conduit: "an HTTP client", tier: "http" },
  {
    match: /^@aws-sdk\//,
    conduit: "an AWS client",
    tier: (specifier) =>
      specifier.includes("sqs") ? "sqs" : specifier.includes("ses") ? "ses" : undefined,
  },
  { match: /^(?:resend|nodemailer)(?:\/|$)/, conduit: "a mail sender", tier: "ses" },
  { match: /^@slack\//, conduit: "Slack", tier: "slack" },
];

function conduitFor(specifier) {
  const entry = CONDUIT_SPECIFIER.find((candidate) => candidate.match.test(specifier));
  if (!entry) return undefined;
  const tier = typeof entry.tier === "function" ? entry.tier(specifier) : entry.tier;
  return { conduit: entry.conduit, tier: tier ?? "<tier>" };
}

function isService(file) {
  return (
    file.role === "process" &&
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
      fix: "Move the conduit to `channels/{{tier}}/{{tier}}.<subject>.channel.ts` and inject the channel interface.",
    },
  },
  applies: isService,
  create(context) {
    const report = (node, { conduit, specifier, tier }) =>
      context.report({ node, messageId: "serviceOpensAChannel", data: { conduit, specifier, tier } });

    return {
      ImportDeclaration(node) {
        const specifier = node.source?.value;
        if (typeof specifier !== "string") return;
        if (node.importKind === "type") return;

        const found = conduitFor(specifier);
        if (found) report(node, { ...found, specifier });
      },
      CallExpression(node) {
        if (node.callee?.type === "Identifier" && node.callee.name === "fetch") {
          report(node, { conduit: "an HTTP client", specifier: "fetch", tier: "http" });
        }
      },
    };
  },
});
