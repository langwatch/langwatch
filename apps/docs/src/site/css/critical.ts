import {
  type CssNode,
  filterStylesheet,
  mapRuleBodies,
  requiredNames,
  serializeStylesheet,
  splitDeclarations,
  splitSelectorList,
  unescapeIdentifier,
} from "./stylesheet.ts";

/** Classes the theme script and menus put on the document at runtime, on every page. */
const THEME_CLASSES = [".dark", ".light", ".chakra-theme"];

function decodeAttribute({ value }: { value: string }) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Every class (`.name`) and id (`#name`) a page's markup carries. */
export function markupNames({ html }: { html: string }) {
  const names = new Set<string>();
  for (const match of html.matchAll(/\s(class|id)=(?:"([^"]*)"|'([^']*)')/g)) {
    const value = decodeAttribute({ value: match[2] ?? match[3] ?? "" });
    const prefix = match[1] === "class" ? "." : "#";
    if (prefix === "#") names.add(`#${value}`);
    else for (const name of value.split(/\s+/)) if (name) names.add(`.${name}`);
  }
  return names;
}

/* Of the names some page carries, those that script text could also add at runtime: a word in
   a client bundle. A rule naming one stays on every page, so an island never waits for it. */
export function scriptedNames({ known, scripts }: { known: Set<string>; scripts: string[] }) {
  const words = new Set<string>();
  for (const script of scripts) for (const [word] of script.matchAll(/[\w-]+/g)) words.add(word);
  return new Set([...known].filter((name) => words.has(name.slice(1))));
}

/** Every custom property name (`--name`, unescaped) mentioned in `text`. */
export function customPropertyNames({ text }: { text: string }) {
  const names = new Set<string>();
  for (const [name] of text.matchAll(/--(?:\\[0-9a-fA-F]{1,6}\s?|\\[\s\S]|[\w-])+/g))
    names.add(unescapeIdentifier({ name }));
  return names;
}

const CUSTOM_DECLARATION = /^(--(?:\\[\s\S]|[^:\\])+):([\s\S]*)$/;

/* Grows `used` with every custom property the values of a used custom property read. */
function markReadValues({ used, values }: { used: Set<string>; values: Map<string, string[]> }) {
  const pending = [...used];
  while (pending.length > 0) {
    for (const value of values.get(pending.pop() ?? "") ?? [])
      for (const name of customPropertyNames({ text: value }))
        if (!used.has(name)) {
          used.add(name);
          pending.push(name);
        }
  }
}

/* Records the custom properties `nodes` read into `used` and each one's declared values. */
function collectDeclarations({
  nodes,
  used,
  values,
}: {
  nodes: CssNode[];
  used: Set<string>;
  values: Map<string, string[]>;
}) {
  const read = ({ text }: { text: string }) => {
    for (const name of customPropertyNames({ text })) used.add(name);
  };
  for (const node of nodes) {
    if (node.kind === "verbatim") read({ text: node.text });
    else if (node.kind === "group") collectDeclarations({ nodes: node.children, used, values });
    else collectRuleBody({ body: node.body, read, values });
  }
}

function collectRuleBody({
  body,
  read,
  values,
}: {
  body: string;
  read: (input: { text: string }) => void;
  values: Map<string, string[]>;
}) {
  for (const declaration of splitDeclarations({ body })) {
    const custom = CUSTOM_DECLARATION.exec(declaration);
    if (!custom) {
      read({ text: declaration });
      continue;
    }
    const name = unescapeIdentifier({ name: custom[1] ?? "" });
    values.set(name, [...(values.get(name) ?? []), custom[2] ?? ""]);
  }
}

/* Drops custom property declarations nothing reads: no var() in the kept rules, no mention in
   the page or a client bundle, and no kept custom property whose value reads them. */
function pruneCustomProperties({ nodes, mentioned }: { nodes: CssNode[]; mentioned: Set<string> }) {
  const values = new Map<string, string[]>();
  const used = new Set(mentioned);
  collectDeclarations({ nodes, used, values });
  markReadValues({ used, values });
  return mapRuleBodies({
    nodes,
    body: ({ body }) =>
      splitDeclarations({ body })
        .filter((declaration) => {
          const custom = CUSTOM_DECLARATION.exec(declaration);
          return !custom || used.has(unescapeIdentifier({ name: custom[1] ?? "" }));
        })
        .join(";"),
  });
}

const KEYFRAMES = /^@(?:-webkit-)?keyframes\s+([^\s{]+)/i;

/** Every word (`[\w-]+`) of `text`: a superset of the animation names it can refer to. */
export function wordsOf({ text }: { text: string }) {
  return new Set(Array.from(text.matchAll(/[\w-]+/g), ([word]) => word));
}

/* Adds to `named` every word outside a `@keyframes` block: the names that can start one. */
function collectAnimationWords({ nodes, named }: { nodes: CssNode[]; named: Set<string> }) {
  for (const node of nodes) {
    if (node.kind === "group") {
      collectAnimationWords({ nodes: node.children, named });
      continue;
    }
    const text = node.kind === "rule" ? node.body : node.text;
    if (node.kind === "verbatim" && KEYFRAMES.test(text)) continue;
    for (const word of wordsOf({ text })) named.add(word);
  }
}

/* The tree without the `@keyframes` `named` lacks; groups left empty go too. */
function keepNamedKeyframes({ nodes, named }: { nodes: CssNode[]; named: Set<string> }): CssNode[] {
  return nodes.flatMap((node): CssNode[] => {
    if (node.kind === "rule") return [node];
    if (node.kind === "verbatim") {
      const name = KEYFRAMES.exec(node.text)?.[1];
      return name === undefined || named.has(name) ? [node] : [];
    }
    const children = keepNamedKeyframes({ nodes: node.children, named });
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/* Drops `@keyframes` no kept rule, custom property, client script or page style names: Chakra
   declares every animation of the system, and a page uses a handful. */
function pruneKeyframes({
  nodes,
  animationWords,
}: {
  nodes: CssNode[];
  animationWords: Set<string>;
}) {
  const named = new Set(animationWords);
  collectAnimationWords({ nodes, named });
  return keepNamedKeyframes({ nodes, named });
}

/** The rules of `nodes` a page can match (a name no page carries counts as present), with the
    custom properties and keyframes something reads. `mentioned`: custom properties the page and
    bundles name; `animationWords`: words of the bundles and the page's style attributes. */
export function criticalCss({
  nodes,
  page,
  known,
  scripted,
  mentioned,
  animationWords,
}: {
  nodes: CssNode[];
  page: Set<string>;
  known: Set<string>;
  scripted: Set<string>;
  mentioned: Set<string>;
  animationWords: Set<string>;
}) {
  const present = (name: string) =>
    page.has(name) || !known.has(name) || scripted.has(name) || THEME_CLASSES.includes(name);
  const keep = (selector: string) =>
    splitSelectorList({ selector }).some((complex) =>
      requiredNames({ selector: complex }).every(present),
    );
  const matched = filterStylesheet({ nodes, keep });
  const pruned = pruneCustomProperties({ nodes: matched, mentioned });
  return serializeStylesheet({ nodes: pruneKeyframes({ nodes: pruned, animationWords }) });
}
