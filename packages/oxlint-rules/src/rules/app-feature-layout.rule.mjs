import {
  APP_LAYER_NOUN,
  appImportCrossing,
  appTargetPath,
  placeOf,
} from "../../grammar/app-feature-layout.mjs";
import { defineRule } from "../define-rule.mjs";

// One rule over the app-features layout (grammar/app-feature-layout.mjs): an
// opted-in application's features import each other only through a declared,
// acyclic dependency and a layer entry, and each layer takes only what its row allows.

function sourceOf(node) {
  const value = node.source?.value;

  return typeof value === "string" ? value : undefined;
}

function isAppFeatureSource(file) {
  return file.kind === "app-features" && !file.isTest;
}

/** What `to` is called in a message: a layer entry, a layer, or a top-level place. */
function describe(place, path) {
  if (place.area === "entry") return `the ${place.feature} ${place.layer} entry`;
  if (place.area === "feature") return `${APP_LAYER_NOUN[place.layer]} of ${place.feature}`;

  return `\`${path}\``;
}

/** A finding on the file as a whole: its place or its feature's declaration. */
function placeFinding({ appFeatures }) {
  const { cycles, features, place } = appFeatures;
  if (place.area === "unknown")
    return { data: { folder: place.folder }, messageId: "unknownPlace" };
  if (place.area !== "feature" && place.area !== "entry") return undefined;
  if (!features.has(place.feature)) {
    return { data: { feature: place.feature }, messageId: "undeclaredFeature" };
  }
  const cycle = cycles.get(place.feature);

  return cycle && { data: { cycle: cycle.join(" -> ") }, messageId: "dependencyCycle" };
}

/** An entry re-exports its own layer's files by name and holds nothing else. */
function entryStatementFinding({ node, place, sourcePath }) {
  const specifier = node.type === "ExportNamedDeclaration" ? sourceOf(node) : undefined;
  const path = specifier && appTargetPath({ sourcePath, specifier });
  const target = path && placeOf(path);
  const own = target?.area === "feature" && target.feature === place.feature;

  return own && target.layer === place.layer ? undefined : "entryShape";
}

export const appFeatureLayoutRule = defineRule({
  name: "app-feature-layout",
  kind: "problem",
  applies: isAppFeatureSource,
  messages: {
    layerCrossing: {
      what: "This {{fromLayer}} file of {{fromFeature}} imports {{to}} (`{{specifier}}`).",
      why: "model takes model; ui takes model and ui; compile and browser take model and their own layer, never ui.",
      fix: "Move what both sides need into the lower layer's `model/` and import it from there. See the `repo-tree` skill.",
    },
    internalReach: {
      what: "This file reaches into {{to}} (`{{specifier}}`).",
      why: "A feature's files are its own; other features and the composition see only its layer entries.",
      fix: "Re-export the symbol from `features/{{feature}}/{{layer}}.ts` and import it from that entry. See the `repo-tree` skill.",
    },
    undeclaredDependency: {
      what: "Feature {{fromFeature}} imports feature {{feature}}, which it does not declare (`{{specifier}}`).",
      why: "The app's package.json declares every edge between features, so the graph stays acyclic and reviewable.",
      fix: 'Add "{{feature}}" to `langwatch.features.{{fromFeature}}` in the app\'s package.json, or move the code so the import is not needed. See the `repo-tree` skill.',
    },
    ownEntry: {
      what: "This file imports its own feature's entry (`{{specifier}}`).",
      why: "An entry re-exports the feature's files; importing it from inside builds a cycle through the entry.",
      fix: "Import the file the entry re-exports directly. See the `repo-tree` skill.",
    },
    reachesComposition: {
      what: "A feature imports the composition (`{{specifier}}`).",
      why: "The composition (app/, site/, browser/) assembles features; a feature that names it loops back on itself.",
      fix: "Move what the feature needs into its own `model/` or into `lib/`, and pass anything the composition owns in as a parameter. See the `repo-tree` skill.",
    },
    leafReachesUp: {
      what: "Shared code imports {{to}} (`{{specifier}}`).",
      why: "`lib/` and the top-level files are leaves every place imports; a leaf naming a feature drags it everywhere.",
      fix: "Move the shared piece into `lib/`, or move this code into the feature that needs it. See the `repo-tree` skill.",
    },
    entryShape: {
      what: "A feature entry holds something other than a named re-export of its own layer.",
      why: "`features/<name>/<layer>.ts` names the layer's public surface and nothing else.",
      fix: 'Write only `export { name } from "./<layer>/<file>.ts"` lines here and move code into the layer folder. See the `repo-tree` skill.',
    },
    unknownPlace: {
      what: "`{{folder}}` is no place in the app-features layout.",
      why: "A file sits in a feature layer or entry, `lib/`, `src/` itself, or the composition: app/, site/, browser/, testing/.",
      fix: "Move the file into `features/<name>/<model|compile|ui|browser>/`, `lib/` or the composition folder that uses it. See the `repo-tree` skill.",
    },
    undeclaredFeature: {
      what: "Feature `{{feature}}` is not declared in the app's package.json.",
      why: "The declared feature graph is what the dependency check reads; an undeclared feature escapes it.",
      fix: 'Add `"{{feature}}": [<the features it imports>]` to `langwatch.features` in the app\'s package.json. See the `repo-tree` skill.',
    },
    dependencyCycle: {
      what: "The declared feature graph has a cycle: {{cycle}}.",
      why: "Features that need each other are one feature, or share a piece that belongs lower down.",
      fix: "Move the shared types or constants into the lower feature's `model/` and drop the upward edge from package.json. See the `repo-tree` skill.",
    },
  },
  create(context, file) {
    const { appFeatures, sourcePath } = file;
    const from = appFeatures.place;
    const needs = appFeatures.features.get(from.feature) ?? [];

    const check = (node) => {
      const specifier = sourceOf(node);
      if (!specifier) return;
      const path = appTargetPath({ sourcePath, specifier });
      if (!path) return;
      const to = placeOf(path);
      const crossing = appImportCrossing({ from, needs, to });
      if (!crossing) return;

      context.report({
        node,
        messageId: crossing.messageId,
        data: {
          feature: to.feature,
          fromFeature: from.feature,
          fromLayer: from.layer,
          layer: to.layer,
          specifier,
          to: describe(to, path),
        },
      });
    };

    return {
      Program(program) {
        const finding = placeFinding(file);
        if (finding) context.report({ node: program, ...finding });
        if (from.area !== "entry") return;
        for (const node of program.body) {
          const messageId = entryStatementFinding({ node, place: from, sourcePath });
          if (messageId) context.report({ node, messageId });
        }
      },
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportDeclaration: check,
      ImportExpression: check,
    };
  },
});
