import { defineRule } from "../define-rule.mjs";

// Authorization fails closed (ARCHITECTURE.md §8): a question a port may leave unanswered is a
// check the door may skip. Data members (declaration options, caller facts) are not questions.

const GOVERNED = /^packages\/api\/src\/(?:access\/.+|hosting\/api-door)\.ts$/;

/** Left optional on purpose: each absence is refused elsewhere or never widens a verdict. */
export const DELIBERATELY_OPTIONAL = new Map([
  ["RestIdentity.authorize", "refused at mount by assertPortsBound, and at request"],
  ["RestIdentity.authorizePlatform", "a platform route behind a door without it is refused"],
  ["RestIdentity.identify", "refused at mount for a route that identifies first"],
  ["RestIdentity.identifyOptional", "refused at mount for a route that identifies optionally"],
  [
    "AccessDenial.developerSeatRestricted",
    "absence changes the refusal's wording, never the verdict",
  ],
  ["Entitlements.refusal", "absence changes the refusal's wording, never the verdict"],
  ["EntitlementGate.when", "absent, every call asks the plan"],
  ["RestCaller.markUsed", "use bookkeeping after the answer, no check"],
  ["TrpcAuditSink.organizationOf", "refused at mount for a procedure whose audit needs it"],
]);

const FUNCTION_TYPES = new Set(["TSFunctionType", "TSConstructorType", "TSMethodSignature"]);

function keyName(key) {
  if (key?.type === "Identifier") return key.name;

  return typeof key?.value === "string" ? key.value : null;
}

function typeOf(member) {
  const type = member.typeAnnotation?.typeAnnotation;
  if (!type) return [];

  return type.type === "TSUnionType" ? type.types : [type];
}

/** A member a caller asks a question of: a method, or a property holding a function. */
function asksAQuestion(member) {
  if (member.type === "TSMethodSignature") return true;

  return (
    member.type === "TSPropertySignature" && typeOf(member).some((t) => FUNCTION_TYPES.has(t.type))
  );
}

function isOptional(member) {
  return member.optional || typeOf(member).some((t) => t.type === "TSUndefinedKeyword");
}

/** Every optional question in the declaration's own object shapes; parameter shapes are inputs. */
function optionalQuestions(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) optionalQuestions(child, found);

    return found;
  }
  if (asksAQuestion(node) && isOptional(node)) found.push(node);
  if (FUNCTION_TYPES.has(node.type)) return found;

  for (const key of Object.keys(node)) {
    if (key !== "parent" && typeof node[key] === "object") optionalQuestions(node[key], found);
  }

  return found;
}

export const authzMembersRequiredRule = defineRule({
  name: "authz-members-required",
  kind: "problem",
  applies: (file) => file.isProduction && GOVERNED.test(file.workspacePath),
  messages: {
    optionalMember: {
      what: "`{{name}}` is an optional question on an exported authorization type.",
      why: "Authorization fails closed: a question a process may leave unanswered is a check the door may skip.",
      fix: "Make `{{name}}` required (drop `?` and `| undefined`) and supply it at every call site. Read the `api-transports` skill.",
    },
  },
  create(context) {
    return {
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (
          declaration?.type !== "TSInterfaceDeclaration" &&
          declaration?.type !== "TSTypeAliasDeclaration"
        ) {
          return;
        }
        const owner = declaration.id.name;
        const shape =
          declaration.type === "TSInterfaceDeclaration"
            ? declaration.body
            : declaration.typeAnnotation;

        for (const member of optionalQuestions(shape)) {
          const name = `${owner}.${keyName(member.key)}`;
          if (DELIBERATELY_OPTIONAL.has(name)) continue;
          context.report({ node: member, messageId: "optionalMember", data: { name } });
        }
      },
    };
  },
});
