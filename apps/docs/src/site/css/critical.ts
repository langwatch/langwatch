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

/* Drops custom property declarations nothing reads: no var() in the kept rules, no mention in
   the page or a client bundle, and no kept custom property whose value reads them. */
function pruneCustomProperties({ nodes, mentioned }: { nodes: CssNode[]; mentioned: Set<string> }) {
  const values = new Map<string, string[]>();
  const used = new Set(mentioned);
  const read = ({ text }: { text: string }) => {
    for (const name of customPropertyNames({ text })) used.add(name);
  };
  const collect = (list: CssNode[]) => {
    for (const node of list) {
      if (node.kind === "verbatim") read({ text: node.text });
      else if (node.kind === "group") collect(node.children);
      else
        for (const declaration of splitDeclarations({ body: node.body })) {
          const custom = CUSTOM_DECLARATION.exec(declaration);
          if (!custom) read({ text: declaration });
          else {
            const name = unescapeIdentifier({ name: custom[1] ?? "" });
            values.set(name, [...(values.get(name) ?? []), custom[2] ?? ""]);
          }
        }
    }
  };
  collect(nodes);
  const pending = [...used];
  while (pending.length > 0) {
    for (const value of values.get(pending.pop() ?? "") ?? [])
      for (const name of customPropertyNames({ text: value }))
        if (!used.has(name)) {
          used.add(name);
          pending.push(name);
        }
  }
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

/**
 * The rules of `nodes` a page can match (a name no page carries counts as present), keeping
 * only the custom properties something reads. `mentioned` lists the custom properties the
 * page markup and client bundles name.
 */
export function criticalCss({
  nodes,
  page,
  known,
  scripted,
  mentioned,
}: {
  nodes: CssNode[];
  page: Set<string>;
  known: Set<string>;
  scripted: Set<string>;
  mentioned: Set<string>;
}) {
  const present = (name: string) =>
    page.has(name) || !known.has(name) || scripted.has(name) || THEME_CLASSES.includes(name);
  const keep = (selector: string) =>
    splitSelectorList({ selector }).some((complex) =>
      requiredNames({ selector: complex }).every(present),
    );
  const matched = filterStylesheet({ nodes, keep });
  return serializeStylesheet({ nodes: pruneCustomProperties({ nodes: matched, mentioned }) });
}
