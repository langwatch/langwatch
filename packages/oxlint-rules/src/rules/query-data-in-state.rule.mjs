import { childNodes } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import {
  collectSetter,
  hookNameOf,
  isBrowserCode,
  isFunction,
  isUpdaterReadingPrevious,
} from "../react-state.mjs";

// Server state lives in React Query only (ARCHITECTURE.md, browser state tiers).
// Reported: `useState(query.data...)` and a setter fed query data from inside an
// effect. Left alone: a setter in an event handler, which seeds an editable draft.

const QUERY_HOOKS = new Set([
  "useQuery",
  "useInfiniteQuery",
  "useSuspenseQuery",
  "useSuspenseInfiniteQuery",
]);
const EFFECTS = new Set(["useEffect", "useLayoutEffect"]);

function dataBindingsOf(declarator) {
  const { id, init } = declarator;
  if (init?.type !== "CallExpression" || !QUERY_HOOKS.has(hookNameOf(init))) return {};
  if (id.type === "Identifier") return { query: id.name };
  if (id.type !== "ObjectPattern") return {};

  const data = id.properties.find((property) => property.key?.name === "data");
  const value = data?.value?.type === "AssignmentPattern" ? data.value.left : data?.value;

  return value?.type === "Identifier" ? { data: value.name } : {};
}

function isQueryDataMember({ node, queries }) {
  if (node.type !== "MemberExpression" || node.computed) return false;
  if (node.property?.name !== "data") return false;

  return node.object.type === "Identifier" && queries.has(node.object.name);
}

function readsQueryData({ node, queries, datas }) {
  if (node.type === "Identifier" && datas.has(node.name)) return true;
  if (isQueryDataMember({ node, queries })) return true;

  return [...childNodes(node)].some((child) => readsQueryData({ node: child, queries, datas }));
}

function setterCallsIn({ node, setters, found }) {
  const callee = node.type === "CallExpression" ? node.callee : undefined;
  if (callee?.type === "Identifier" && setters.has(callee.name)) found.push(node);
  for (const child of childNodes(node)) setterCallsIn({ node: child, setters, found });

  return found;
}

function reportEffectCopies({ context, effect, setters, copiesQuery }) {
  for (const call of setterCallsIn({ node: effect.arguments[0].body, setters, found: [] })) {
    const [argument] = call.arguments;
    if (!argument || isUpdaterReadingPrevious(argument) || !copiesQuery(argument)) continue;
    context.report({
      node: call,
      messageId: "queryCopiedToState",
      data: { origin: `${call.callee.name} in an effect` },
    });
  }
}

export const queryDataInStateRule = defineRule({
  name: "query-data-in-state",
  kind: "problem",
  applies: isBrowserCode,
  messages: {
    queryCopiedToState: {
      what: "Query data is copied into state by `{{origin}}`.",
      why: "A second copy of server state goes stale and fights the cache's refetch, invalidation and optimistic updates.",
      fix: "Read the query result directly in render; keep only the user's own edits in state and overlay them on the query data.",
    },
  },
  create(context) {
    const setters = new Set();
    const queries = new Set();
    const datas = new Set();
    const copiesQuery = (node) => readsQueryData({ node, queries, datas });

    return {
      VariableDeclarator(declarator) {
        collectSetter({ declarator, setters });
        const bound = dataBindingsOf(declarator);
        if (bound.query) queries.add(bound.query);
        if (bound.data) datas.add(bound.data);
      },
      CallExpression(node) {
        const name = hookNameOf(node);
        if (name === "useState" && node.arguments[0] && copiesQuery(node.arguments[0])) {
          context.report({ node, messageId: "queryCopiedToState", data: { origin: "useState" } });
        }
        if (!EFFECTS.has(name) || !isFunction(node.arguments[0])) return;
        reportEffectCopies({ context, effect: node, setters, copiesQuery });
      },
    };
  },
});
