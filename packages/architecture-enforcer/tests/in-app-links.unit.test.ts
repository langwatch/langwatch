/**
 * A literal in-app address on a bare anchor reloads the whole application, and
 * `@langwatch/browser-host/link` is the one link that routes it in place.
 * Spec: specs/ui/in-app-links.feature
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { sourceFile } from "../src/workspace/module-graph.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const BROWSER_HALVES = ["browser/src", "browser-kit/src"];

function sourcesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { encoding: "utf8", recursive: true })
    .filter((relative) => relative.endsWith(".tsx"))
    .filter((relative) => !relative.includes("__tests__") && !relative.includes(".stories."))
    .map((relative) => path.join(dir, relative));
}

function browserSources(): string[] {
  const modules = ["modules", "enterprise/modules"].flatMap((group) => {
    const groupDir = path.join(repoRoot, group);
    return readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        BROWSER_HALVES.flatMap((half) => sourcesUnder(path.join(groupDir, entry.name, half))),
      );
  });
  return [...modules, ...sourcesUnder(path.join(repoRoot, "packages/design-system/src"))];
}

/** The local names a file binds to Chakra's own `Link`, which never routes. */
function chakraLinkNames(tree: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "@chakra-ui/react") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "Link") names.add(element.name.text);
    }
  }
  return names;
}

function literalText(initializer: ts.JsxAttributeValue | undefined): string | undefined {
  if (!initializer) return void 0;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return void 0;
  const expression = initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isTemplateExpression(expression)) return expression.head.text;
  return void 0;
}

/** A literal address this application's router serves, which a document load throws away. */
function isInAppAddress(text: string | undefined): boolean {
  if (text === void 0 || !text.startsWith("/") || text.startsWith("//")) return false;
  return !/^\/api(?:[/?#]|$)/.test(text);
}

/** Whether a bare anchor with these attributes loads an in-app page as a new document. */
function reloadsTheDocument(attributes: Map<string, ts.JsxAttributeValue | undefined>): boolean {
  if (attributes.has("target") || attributes.has("download")) return false;
  const href = literalText(attributes.get("href"));
  return isInAppAddress(href);
}

/** Every bare anchor in the file that carries a literal in-app address and no new tab. */
function reloadingAnchors(file: string): string[] {
  const tree = sourceFile({ file, parents: false });
  const chakraLinks = chakraLinkNames(tree);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      if (tag === "a" || chakraLinks.has(tag)) {
        const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute)) {
            attributes.set(attribute.name.getText(tree), attribute.initializer);
          }
        }
        if (reloadsTheDocument(attributes)) {
          const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
          found.push(`${path.relative(repoRoot, file)}:${line + 1} <${tag}>`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** A module's own `*link.tsx` element that renders an anchor and never routes a click. */
function isUnroutedLinkElement(file: string): boolean {
  if (!/(?:^|-)link\.tsx$/.test(path.basename(file))) return false;
  const text = readFileSync(file, "utf8");
  const rendersAnchor = /<(?:a|ChakraLink|Anchor)\b/.test(text);
  return (
    rendersAnchor && !/\bnavigate\(/.test(text) && !text.includes("@langwatch/browser-host/link")
  );
}

describe("in-app links across the browser packages", () => {
  describe("when every anchor and Chakra link is read", () => {
    /** @scenario "No browser package hard-codes an in-app address on a bare anchor" */
    it("finds no literal in-app address on a bare anchor and no unrouted link element", () => {
      const files = browserSources();
      // A floor, not a target: an empty scan must not pass as a clean one.
      expect(files.length).toBeGreaterThan(1000);

      const anchors = files.flatMap(reloadingAnchors);
      const elements = files
        .filter(isUnroutedLinkElement)
        .map((file) => path.relative(repoRoot, file));

      expect({ anchors, elements }).toEqual({ anchors: [], elements: [] });
    });
  });
});
