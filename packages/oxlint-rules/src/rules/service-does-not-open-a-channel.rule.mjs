import { defineRule } from "../define-rule.mjs";

// A collaborator the module does not own is a channel, not a service member.
// A service that opens the bus, a vendor over HTTP, a queue, email or Slack
// has no seam a test can stand in for, and no name for the message it is
// really sending. A Redis client is store-containment's.

// `tier` names the `channels/<tier>/` folder the implementation belongs in
// (see CHANNEL_TIERS in feature-layout-policy.mjs). Fixed per conduit except
// AWS, where the same package covers several services and `tier` is read off
// the specifier itself, falling back to a literal `<tier>` placeholder only
// when even that can't tell SES from SQS from an untiered service like S3.
const AWS_TIERS = ["sqs", "ses"];

// Eventing helpers, errors and types open nothing; only these construct the
// bus or a queue processor.
const EVENTING_CONDUITS = new Set([
  "EventSourcing",
  "EventSourcingPipeline",
  "EventSourcingService",
  "EventSourcedQueueProcessor",
  "mapCommands",
  "createEventingGroupQueueFactory",
  "ProcessRuntime",
  "EventingServerRuntime",
]);

const CONDUIT_SPECIFIER = [
  {
    match: /^@langwatch\/eventing(?:\/server)?$/,
    conduit: "the event bus",
    tier: "eventing",
    names: EVENTING_CONDUITS,
  },
  { match: /^(?:undici|axios|got|node-fetch)(?:\/|$)/, conduit: "an HTTP client", tier: "http" },
  { match: /^node:https?$/, conduit: "an HTTP client", tier: "http" },
  {
    match: /^@aws-sdk\//,
    conduit: "an AWS client",
    tier: (specifier) => AWS_TIERS.find((tier) => specifier.includes(tier)),
  },
  { match: /^(?:resend|nodemailer)(?:\/|$)/, conduit: "a mail sender", tier: "ses" },
  { match: /^@slack\//, conduit: "Slack", tier: "slack" },
];

function importedName(binding) {
  if (binding.type !== "ImportSpecifier" || binding.importKind === "type") return undefined;

  return binding.imported?.name ?? binding.imported?.value;
}

/** The named value bindings of an import that are in `names`, joined for the message. */
function namedConduits(node, names) {
  const found = (node.specifiers ?? []).map(importedName).filter((name) => names.has(name));

  return found.length > 0 ? found.join(", ") : undefined;
}

function conduitFor(node) {
  const specifier = node.source.value;
  const entry = CONDUIT_SPECIFIER.find((candidate) => candidate.match.test(specifier));
  if (!entry) return undefined;
  const named = entry.names ? namedConduits(node, entry.names) : specifier;
  if (!named) return undefined;
  const tier = typeof entry.tier === "function" ? entry.tier(specifier) : entry.tier;

  return { conduit: entry.conduit, specifier: named, tier: tier ?? "<tier>" };
}

function isFetchCallee(callee) {
  if (callee?.type === "Identifier") return callee.name === "fetch";
  if (callee?.type !== "MemberExpression") return false;
  if (callee.object?.type !== "Identifier" || callee.object.name !== "globalThis") return false;

  return callee.computed ? callee.property?.value === "fetch" : callee.property?.name === "fetch";
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
      context.report({
        node,
        messageId: "serviceOpensAChannel",
        data: { conduit, specifier, tier },
      });

    return {
      ImportDeclaration(node) {
        if (typeof node.source?.value !== "string") return;
        if (node.importKind === "type") return;

        const found = conduitFor(node);
        if (found) report(node, found);
      },
      CallExpression(node) {
        if (isFetchCallee(node.callee)) {
          report(node, { conduit: "an HTTP client", specifier: "fetch", tier: "http" });
        }
      },
    };
  },
});
