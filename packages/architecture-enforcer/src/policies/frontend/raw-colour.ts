import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * ARCHITECTURE.md §17, rule 1: browser colours are design-system semantic tokens, never
 * `var(--chakra-colors-*)`, a hex value or an rgb()/hsl() function in a style value.
 * Shrink-only: tests/baselines/raw-colour.json holds each file's count; this policy never reads it.
 */

export const RAW_COLOUR_POLICY = "raw-colour";
export const RAW_COLOUR_RATCHET = "packages/architecture-enforcer/tests/baselines/raw-colour.json";

const SCANNED = ["modules", "enterprise/modules", "apps/ui/src", "apps/sims/src"] as const;
/** A module folder's source, but not its contract or process folder (never the Design System). */
const BROWSER_SOURCE =
  /^(?:(?:enterprise\/)?modules\/[^/]+\/(?!contract\/|process\/)[^/]+\/src\/|apps\/(?:ui|sims)\/src\/)/;
const SOURCE_FILE = /\.(?:[cm]?tsx?|jsx?)$/;
const NOT_RUNTIME =
  /(?:^|\/)(?:__tests__|__fixtures__|__mocks__|e2e)\/|\.(?:test|spec|stories|fixture)\.[cm]?[jt]sx?$/;

export function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

/** Whether a repo-relative path is browser source these frontend policies read. */
export function isBrowserSource(path: string): boolean {
  return BROWSER_SOURCE.test(path) && SOURCE_FILE.test(path) && !NOT_RUNTIME.test(path);
}

/** Every browser source file: module folders bar contract and process, apps/ui and apps/sims. */
export function browserSourceFiles(snapshot: WorkspaceSnapshot): string[] {
  const { root } = snapshot;

  return SCANNED.flatMap((directory) =>
    snapshot.files({
      directory: join(root, directory),
      accept: (file) => isBrowserSource(workspacePath({ root, file })),
    }),
  );
}

export function lineOf({ source, at }: { source: ts.SourceFile; at: number }): number {
  return source.getLineAndCharacterOfPosition(at).line + 1;
}

const CHAKRA_COLOUR_VARIABLE = /var\(\s*--chakra-colors-[\w-]+/g;
const COLOUR_VALUE =
  /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|\b(?:rgba?|hsla?)\(\s*[-+.\d][^()]*\)/gi;
/** A CSS declaration in a string, `box-shadow: 0 0 2px `, right before the colour. */
const CSS_DECLARATION_BEFORE =
  /(?:colou?r|background[\w-]*|border[\w-]*|fill|stroke|shadow|outline[\w-]*)\s*:[^;:{}]*$/i;
/** A prop or object key whose value is a colour: `color`, `bg`, `borderColor`, `_hover`, `css`. */
const STYLE_KEY =
  /^(?:_[a-z]\w*|bg|background\w*|border(?:Top|Right|Bottom|Left|Inline|Block|X|Y)?|border\w*Colou?r|fill|stroke|\w*[Ss]hadow|outline\w*|css|sx|style|colou?r|\w*Colou?r)$/;

type Finding = { file: string; line: number; colour: string };

function keyName(name: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isJsxNamespacedName(name)) return name.name.text;

  return void 0;
}

/** A statement, function or JSX element: where a string stops being carried to a key. */
function endsTheClimb(node: ts.Node): boolean {
  if (ts.isStatement(node) || ts.isFunctionLike(node)) return true;

  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

/** What one step of the climb decides: style, not style, or keep climbing. */
function climbStep(current: ts.Node): boolean | undefined {
  if (ts.isPropertyAssignment(current) || ts.isJsxAttribute(current)) {
    const name = keyName(current.name);
    if (name !== undefined && STYLE_KEY.test(name)) return true;

    return ts.isJsxAttribute(current) ? false : void 0;
  }
  if (ts.isTaggedTemplateExpression(current))
    return /^(?:css|keyframes|styled)\b/.test(current.tag.getText());

  return endsTheClimb(current) ? false : void 0;
}

/** Climbs from a string through the expressions that only carry it, to the key it values. */
function isStyleValue(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    const decided = climbStep(current);
    if (decided !== undefined) return decided;
  }

  return false;
}

function stringText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) return node.text;
  if (ts.isTemplateTail(node)) return node.text;

  return void 0;
}

function colourSites({ file, path }: { file: string; path: string }): Finding[] {
  const text = sourceText({ file });
  if (!/var\(\s*--chakra-colors-|#[\da-f]{3}|\b(?:rgba?|hsla?)\(/i.test(text)) return [];

  const source = sourceFile({ file });
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const value = stringText(node);
    if (value !== undefined) {
      const at = node.getStart(source);
      // The text starts one character in, after the quote, backtick or `}`; escapes may shift it.
      for (const match of value.matchAll(CHAKRA_COLOUR_VARIABLE))
        found.push({
          file: path,
          line: lineOf({ source, at: at + 1 + match.index }),
          colour: `${match[0]})`,
        });
      for (const match of value.matchAll(COLOUR_VALUE)) {
        const before = value.slice(0, match.index);
        if (CSS_DECLARATION_BEFORE.test(before) || isStyleValue(node))
          found.push({
            file: path,
            line: lineOf({ source, at: at + 1 + match.index }),
            colour: match[0],
          });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Each raw colour in a style value of browser code, one finding per use. */
export function collectRawColours(snapshot: WorkspaceSnapshot): Finding[] {
  const { root } = snapshot;

  return browserSourceFiles(snapshot).flatMap((file) =>
    colourSites({ file, path: workspacePath({ root, file }) }),
  );
}

/** The shrink-only key: the file. */
export function rawColourKey(finding: Finding): string {
  return finding.file;
}

export function lintRawColours(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectRawColours(snapshot).map((finding) => ({
    policy: RAW_COLOUR_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.colour,
    message: `\`${finding.colour}\` is a raw colour in browser code: it skips the design system's semantic tokens, so it does not follow the colour mode or a theme change.`,
    allowed: `Name a semantic token as the value (\`color="fg.muted"\`, \`bg="bg.subtle"\`, \`borderColor="border.emphasized"\`); a colour the theme lacks is added to packages/design-system first. Each file's count in ${RAW_COLOUR_RATCHET} may fall, never rise: lower it in the change that removes a use.`,
  }));
}
