import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { browserSourceFiles, lineOf, workspacePath } from "./raw-colour.ts";

/**
 * ARCHITECTURE.md §17, rule 6: browser code uses design-system components, never rebuilt from
 * Chakra parts (a `chakra.*` factory, an in-app `Link` that skips the router, a hand-made red
 * form error). Shrink-only: tests/baselines/design-system-recomposition.json counts per kind.
 */

export const RECOMPOSITION_POLICY = "design-system-recomposition";
export const RECOMPOSITION_RATCHET =
  "packages/architecture-enforcer/tests/baselines/design-system-recomposition.json";

/** Where `chakra`, `Link`, `Text` and `Box` come from: the design system, or Chakra itself. */
const DESIGN_SYSTEM_SOURCE =
  /^(?:@langwatch\/design-system(?:-internal)?(?:\/primitives)?|@chakra-ui\/react)$/;
const FACTORY_ELEMENTS = new Set(["button", "input", "a"]);
const ERROR_COLOUR = "red.fg";

export type RecompositionKind =
  | "chakra.button"
  | "chakra.input"
  | "chakra.a"
  | "in-app-link"
  | "form-error-text";

type Finding = { file: string; line: number; kind: RecompositionKind };

const INSTEAD: Record<RecompositionKind, { message: string; allowed: string }> = {
  "chakra.button": {
    message:
      "`chakra.button` rebuilds a button from a bare element, without the design system's focus ring, disabled state and sizes.",
    allowed:
      'Use `Button` or `IconButton` from @langwatch/design-system/primitives (`variant="ghost"` or `unstyled` for a bare look).',
  },
  "chakra.input": {
    message:
      "`chakra.input` rebuilds an input from a bare element, without the design system's field styles and states.",
    allowed:
      'Use `Input` from @langwatch/design-system/primitives (`variant="flushed"` or `unstyled` for a bare look).',
  },
  "chakra.a": {
    message:
      "`chakra.a` rebuilds a link from a bare anchor: an in-app path reloads the page instead of going through the router.",
    allowed:
      'Use `Link` from @langwatch/browser-host/link for an in-app path, or the design system\'s `Link` with `target="_blank"` for an external one.',
  },
  "in-app-link": {
    message:
      "This `Link` sends an in-app path through a plain anchor, so a click reloads the whole application instead of routing.",
    allowed:
      'Use `Link` from @langwatch/browser-host/link for an in-app path; the design system\'s `Link` is for external addresses (`target="_blank"`).',
  },
  "form-error-text": {
    message:
      "A red `Text`/`Box` printing a form field's error rebuilds the design system's field error by hand, away from the field it belongs to.",
    allowed:
      "Wrap the field in `VerticalFormControl` (or `Field.Root` with `invalid` and `Field.ErrorText`) and pass it the error, so it is tied to its field.",
  },
};

type Imported = { name: string; source: string };

function designSystemImports(source: ts.SourceFile): Map<string, string> {
  const found = new Map<string, Imported>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      found.set(element.name.text, {
        name: (element.propertyName ?? element.name).text,
        source: statement.moduleSpecifier.text,
      });
    }
  }

  return new Map(
    [...found]
      .filter(([, imported]) => DESIGN_SYSTEM_SOURCE.test(imported.source))
      .map(([local, imported]) => [local, imported.name]),
  );
}

function attribute(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
}

/** A literal attribute value, `"x"` or `{"x"}` or `` {`x${y}`} ``: its leading text. */
function literalText(value: ts.JsxAttributeValue | undefined): string | undefined {
  const expression = value !== undefined && ts.isJsxExpression(value) ? value.expression : value;
  if (expression === undefined) return void 0;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;
  if (ts.isTemplateExpression(expression)) return expression.head.text;

  return void 0;
}

/** An `onClick` that cancels the anchor and navigates itself: a router link built by hand. */
const HAND_ROUTED = /\bpreventDefault\(\)[\s\S]*\b(?:navigate|push|replace)\(/;

/** An in-app path, literal or routed by hand in `onClick`, not marked as leaving the app. */
function isInAppLink(attributes: ts.JsxAttributes): boolean {
  if (attribute(attributes, "isExternal") !== undefined) return false;
  if (literalText(attribute(attributes, "target")?.initializer) === "_blank") return false;
  const href = literalText(attribute(attributes, "href")?.initializer);
  const isInAppPath = href?.startsWith("/") === true && !href.startsWith("//");
  if (isInAppPath) return true;
  const onClick = attribute(attributes, "onClick")?.initializer;

  return onClick !== undefined && HAND_ROUTED.test(onClick.getText());
}

/** `errors.name` or `errors[name]`: the entry a `.message` read hangs off. */
function readsErrorsEntry(owner: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(owner) && !ts.isElementAccessExpression(owner)) return false;
  const path = owner.expression.getText().replace(/\?/g, "");

  return /(?:^|\.)errors$/.test(path);
}

/** `errors.name.message`, `formState.errors.name?.message`, `formState.errors` itself. */
function readsFormError(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(child)) {
      const owner = child.expression;
      if (child.name.text === "errors" && /\bformState$/.test(owner.getText())) found = true;
      if (child.name.text === "message" && readsErrorsEntry(owner)) found = true;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);

  return found;
}

function factoryKind(
  tag: ts.Node,
  imports: ReadonlyMap<string, string>,
): RecompositionKind | undefined {
  if (!ts.isPropertyAccessExpression(tag) || !ts.isIdentifier(tag.expression)) return void 0;
  const isChakra = imports.get(tag.expression.text) === "chakra";
  if (!isChakra || !FACTORY_ELEMENTS.has(tag.name.text)) return void 0;

  return `chakra.${tag.name.text}` as RecompositionKind;
}

function elementKind({
  tag,
  attributes,
  element,
  imports,
}: {
  tag: ts.JsxTagNameExpression;
  attributes: ts.JsxAttributes;
  element: ts.Node;
  imports: ReadonlyMap<string, string>;
}): RecompositionKind | undefined {
  const factory = factoryKind(tag, imports);
  if (factory !== undefined) return factory;
  if (!ts.isIdentifier(tag)) return void 0;

  const imported = imports.get(tag.text);
  if (imported === "Link" && isInAppLink(attributes)) return "in-app-link";
  if (imported !== "Text" && imported !== "Box") return void 0;

  return isFormErrorText({ attributes, element }) ? "form-error-text" : void 0;
}

/** A red element whose children read a form field's error. */
function isFormErrorText({
  attributes,
  element,
}: {
  attributes: ts.JsxAttributes;
  element: ts.Node;
}): boolean {
  const colour = literalText(attribute(attributes, "color")?.initializer);
  if (colour !== ERROR_COLOUR || !ts.isJsxElement(element)) return false;

  return element.children.some(readsFormError);
}

/** `chakra("button")`: the factory called with an element name. */
function factoryCallKind({
  call,
  imports,
}: {
  call: ts.CallExpression;
  imports: ReadonlyMap<string, string>;
}): RecompositionKind | undefined {
  if (!ts.isIdentifier(call.expression)) return void 0;
  if (imports.get(call.expression.text) !== "chakra") return void 0;
  const [first] = call.arguments;
  if (first === undefined || !ts.isStringLiteral(first)) return void 0;

  return FACTORY_ELEMENTS.has(first.text) ? (`chakra.${first.text}` as RecompositionKind) : void 0;
}

function recompositions({ file, path }: { file: string; path: string }): Finding[] {
  if (!/@langwatch\/design-system|@chakra-ui\/react/.test(sourceText({ file }))) return [];

  const source = sourceFile({ file });
  const imports = designSystemImports(source);
  if (imports.size === 0) return [];

  const found: Finding[] = [];
  const record = (kind: RecompositionKind | undefined, node: ts.Node): void => {
    if (kind !== undefined)
      found.push({ file: path, line: lineOf({ source, at: node.getStart(source) }), kind });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const { tagName, attributes } = node.openingElement;
      record(elementKind({ tag: tagName, attributes, element: node, imports }), node);
    } else if (ts.isJsxSelfClosingElement(node)) {
      record(
        elementKind({ tag: node.tagName, attributes: node.attributes, element: node, imports }),
        node,
      );
    } else if (ts.isCallExpression(node)) {
      record(factoryCallKind({ call: node, imports }), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Each recomposed design-system component in browser code, one finding per element. */
export function collectRecompositions(snapshot: WorkspaceSnapshot): Finding[] {
  const { root } = snapshot;

  return browserSourceFiles(snapshot).flatMap((file) =>
    recompositions({ file, path: workspacePath({ root, file }) }),
  );
}

/** The shrink-only key: the file and the kind. */
export function recompositionKey(finding: Finding): string {
  return `${finding.file}|${finding.kind}`;
}

export function lintDesignSystemRecomposition(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  return collectRecompositions(snapshot).map((finding) => ({
    policy: RECOMPOSITION_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.kind,
    message: INSTEAD[finding.kind].message,
    allowed: `${INSTEAD[finding.kind].allowed} Each file's count per kind in ${RECOMPOSITION_RATCHET} may fall, never rise: lower it in the change that removes a use.`,
  }));
}
