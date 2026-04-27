import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const FILTER_TOKEN_REGEX =
  /(?:NOT\s+|-)?[a-zA-Z]+:(?:"[^"]*"|\[[^\]]*\]|[^\s()]+)/g;

export const FilterHighlight = Extension.create({
  name: "filterHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("filterHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;

              FILTER_TOKEN_REGEX.lastIndex = 0;
              let match: RegExpExecArray | null = null;
              while ((match = FILTER_TOKEN_REGEX.exec(node.text)) !== null) {
                const from = pos + match.index;
                const to = from + match[0].length;
                const isNegated =
                  match[0].startsWith("NOT ") || match[0].startsWith("-");

                decorations.push(
                  Decoration.inline(from, to, {
                    class: isNegated
                      ? "filter-token filter-token-exclude"
                      : "filter-token",
                  })
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
