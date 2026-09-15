import { crossingFor } from "../../grammar/module-layers.mjs";
import { defineRule } from "../define-rule.mjs";

// A channel carries messages to and from something the module does not own,
// so it takes the client it speaks to. A channel that reads a repository or
// calls a service has quietly become a second app, and the one place a reader
// looks for the module's behaviour stops being the app.

const STORE_SPECIFIER = /^\.?prisma\/client(?:\/|$)|^@prisma\/client(?:\/|$)/;

function isChannel(file) {
  return (
    file.role === "server" && file.isProduction && Boolean(file.sourcePath?.startsWith("channels/"))
  );
}

export const channelTakesOnlyItsClientRule = defineRule({
  name: "channel-takes-only-its-client",
  kind: "problem",
  messages: {
    channelTakesMoreThanItsClient: {
      what: "A channel names {{crossed}} (`{{specifier}}`).",
      why: "A channel takes the client it speaks to. State is the repository's, behaviour is the app's, and a channel that reads either becomes a second app nobody looks in.",
      fix: "Take the client alone and let the service that owns the decision call this channel.",
    },
  },
  applies: isChannel,
  create(context, file) {
    return {
      ImportDeclaration(node) {
        const specifier = node.source?.value;
        if (typeof specifier !== "string") return;
        if (node.importKind === "type") return;

        const crossed = STORE_SPECIFIER.test(specifier)
          ? "the database client"
          : crossingFor({ layer: "channels", sourcePath: file.sourcePath, specifier });

        if (crossed) {
          context.report({
            node,
            messageId: "channelTakesMoreThanItsClient",
            data: { crossed, specifier },
          });
        }
      },
    };
  },
});
