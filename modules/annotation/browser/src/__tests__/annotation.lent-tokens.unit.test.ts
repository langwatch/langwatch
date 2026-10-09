/**
 * @vitest-environment jsdom
 * Annotation lends its components by the tokens in its client package, so a reader
 * renders them without importing annotation's browser package (§10.1).
 */
import {
  AnnotateBodyToken,
  AnnotationFormFooterToken,
  SuggestBodyToken,
} from "@langwatch/annotation-client";
import { describe, expect, it } from "vitest";

import { annotationWeb } from "../annotation.web.ts";

async function loadLent({ key }: { key: string }) {
  const lend = annotationWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the annotation browser declaration", () => {
  describe("when a reader looks up each token from annotation's client", () => {
    /** @scenario Each wave 2 owner lends its components by its client tokens */
    it.each([AnnotateBodyToken, AnnotationFormFooterToken, SuggestBodyToken])(
      "loads the lent component for $key",
      async (token) => {
        const loaded = await loadLent(token);

        expect(loaded).toHaveProperty("default");
      },
    );
  });
});
