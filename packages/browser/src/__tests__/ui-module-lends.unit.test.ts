import { uiTokens } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { checkLends } from "../ui-module-lends.ts";
import { defineBrowserModule } from "../web-module.ts";

const Peek = uiTokens("trace").component<{ traceId: string }>("traceIdPeek");
const Editor = uiTokens("evaluator").drawer<{ evaluatorId?: string }>("evaluatorEditor");
const Card = uiTokens("organization").extension<{ organizationId: string }>("overviewCard");

const peek = { load: () => Promise.resolve({ default: (_props: { traceId: string }) => null }) };
const editor = {
  load: () => Promise.resolve({ default: (_props: { evaluatorId?: string }) => null }),
};
const card = {
  load: () => Promise.resolve({ default: (_props: { organizationId: string }) => null }),
};

describe("checkLends", () => {
  describe("given each token lent by its owner", () => {
    /** @scenario An owner's lends and drawers install */
    it("raises nothing, extension tokens included", () => {
      expect(() =>
        checkLends({
          modules: [
            defineBrowserModule("trace").lends(Peek, peek),
            defineBrowserModule("evaluator").drawer(Editor, editor),
            defineBrowserModule("scim").lends(Card, card),
            defineBrowserModule("sso").lends(Card, card),
          ],
        }),
      ).not.toThrow();
    });
  });

  describe("given a module lending a token another module owns", () => {
    /** @scenario A foreign owner's token is refused at install */
    it("refuses, naming the module and the owner", () => {
      const foreign = defineBrowserModule("experiment");
      // The compile-time check forbids this call; the runtime twin must still refuse it.
      // @ts-expect-error only the owner lends a component token
      const lent = foreign.lends(Peek, peek);

      expect(() => checkLends({ modules: [lent] })).toThrow(/"experiment".*"trace"/);
    });
  });

  describe("given two modules lending one token", () => {
    /** @scenario Two lenders of one token are refused, naming both */
    it("refuses, naming both lenders", () => {
      expect(() =>
        checkLends({
          modules: [
            defineBrowserModule("trace").lends(Peek, peek),
            defineBrowserModule("trace").lends(Peek, peek),
          ],
        }),
      ).toThrow(/Token "trace.traceIdPeek" is lent by both "trace" and "trace"/);
    });
  });
});

describe("a module's lend", () => {
  describe("when it lends by token", () => {
    /** @scenario A token lend is also declared under the legacy name */
    it("declares the payload under the token's name too", () => {
      const module = defineBrowserModule("trace").lends(Peek, peek);

      expect(module.installation.lends).toHaveLength(1);
      expect(Object.keys(module.installation.capabilities)).toEqual(["traceIdPeek"]);
    });
  });

  describe("when it registers a drawer by token", () => {
    /** @scenario A drawer token registers under its wire name */
    it("registers the loader under the wire name", () => {
      const module = defineBrowserModule("evaluator").drawer(Editor, editor);

      expect(Object.keys(module.installation.drawers)).toEqual(["evaluatorEditor"]);
    });
  });
});
