import { describe, expect, it } from "vitest";

import { extractStyles } from "../static-styles.mjs";

describe("static style extraction", () => {
  /** @scenario "Extract the exact server styles" */
  it("keeps ordered CSS and readable markup without executing server state", () => {
    const result = extractStyles({
      html: '<style data-emotion="global">:root{--paper:cream}</style><article class="paper">Readable</article><style data-emotion="css">.paper{background:var(--paper)}</style><script>hydrate()</script>',
    });
    expect(result.html).toBe('<article class="paper">Readable</article>');
    expect(result.css).toBe(":root{--paper:cream}\n.paper{background:var(--paper)}");
    expect(extractStyles({ html: "<style>.paper{background:red}</style>" }).href).not.toBe(
      result.href,
    );
  });
});
