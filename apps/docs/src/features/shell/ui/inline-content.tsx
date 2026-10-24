import { Link } from "@langwatch/design-system/primitives";

import { sitePath } from "../../../lib/site-path.ts";
import type { Inline } from "../../navigation/model/inline.ts";

/** docs.json inline Markdown as markup; site links follow the build's base path. */
export function InlineContent({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type === "code") return <code key={index}>{node.value}</code>;
    if (node.type === "strong")
      return (
        <strong key={index}>
          <InlineContent nodes={node.children} />
        </strong>
      );
    return (
      <Link key={index} href={sitePath({ path: node.href })} color="inherit">
        <InlineContent nodes={node.children} />
      </Link>
    );
  });
}
