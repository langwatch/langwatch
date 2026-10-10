import { defineRule } from "../define-rule.mjs";
import { isBrowserCode } from "../react-state.mjs";

// A global store is refused (ARCHITECTURE.md, browser state tiers): server
// state is React Query, URL state the router, shared client state one zustand
// store per feature under `behavior/`.

const REDUX = /^(?:redux|react-redux|@reduxjs\/toolkit|redux-[\w-]+)(?:\/|$)/;

export const noReduxRule = defineRule({
  name: "no-redux",
  kind: "problem",
  applies: isBrowserCode,
  messages: {
    reduxImported: {
      what: "`{{specifier}}` brings Redux into browser code.",
      why: "A global store couples every feature to one shape; the record gives each kind of state its own home.",
      fix: "Server data goes in React Query, address-bar state in the router, shared client state in the feature's own zustand store under `behavior/`. Read the `browser-module` skill.",
    },
  },
  create(context) {
    const check = (node) => {
      const specifier = node.source?.value;
      if (typeof specifier !== "string" || !REDUX.test(specifier)) return;
      context.report({ node, messageId: "reduxImported", data: { specifier } });
    };

    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportDeclaration: check,
      ImportExpression: check,
    };
  },
});
