import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { languageScript, themeScript } from "../document.ts";

/* The docs host allows these two scripts by hash (local.docs_site_content_security_policy in
   langwatch-saas infrastructure/docs-site.tf). Change a script, change the hash there too. */
const ALLOWED = {
  theme: "sha256-b+QUjVcfcnwj2dIQAasZQazvYI0d64Cf9ezdWaXBNhs=",
  language: "sha256-Oc/eUJOWymRN8U5yoi3WrEK4LvWdCaksXPVB5tlijGY=",
};

function scriptHash({ script }: { script: string }) {
  const body = /^<script>([\s\S]*)<\/script>$/.exec(script)?.[1];
  if (body === undefined) throw new Error("not a bare <script> element: update the hashing here");
  return `sha256-${createHash("sha256").update(body).digest("base64")}`;
}

describe("when the docs host's Content-Security-Policy allows inline scripts by hash", () => {
  /** @scenario "The inline scripts keep the hashes the Content-Security-Policy allows" */
  it("hashes the theme and code-language scripts to the values the policy names", () => {
    expect({
      theme: scriptHash({ script: themeScript }),
      language: scriptHash({ script: languageScript }),
    }).toEqual(ALLOWED);
  });
});
