import { describe, expect, it } from "vitest";

import { findLangyPromptLink, withoutLangyPromptLink } from "../langy.deep-link.ts";

/** Spec: specs/langy/langy-prompt-link.feature */

describe("findLangyPromptLink", () => {
  it("reads the question from langy=open&langyPrompt", () => {
    expect(
      findLangyPromptLink({ search: "?langy=open&langyPrompt=Which%20traces%3F&x=1" }),
    ).toEqual([{ prompt: "Which traces?" }]);
  });

  it("opens with no question for langy=open alone", () => {
    expect(findLangyPromptLink({ search: "?langy=open" })).toEqual([{ prompt: "" }]);
  });

  it("treats langyPrompt without langy=open as a request to open", () => {
    expect(findLangyPromptLink({ search: "?langyPrompt=hello" })).toEqual([{ prompt: "hello" }]);
  });

  it("asks nothing of an address without the parameters", () => {
    expect(findLangyPromptLink({ search: "?langy=closed&tab=traces" })).toEqual([]);
  });
});

describe("withoutLangyPromptLink", () => {
  it("drops only the link's parameters", () => {
    expect(withoutLangyPromptLink({ search: "?langy=open&langyPrompt=hi&tab=traces" })).toBe(
      "?tab=traces",
    );
    expect(withoutLangyPromptLink({ search: "?langy=open&langyPrompt=hi" })).toBe("");
  });

  it("keeps a langyConversation link when the question is blank", () => {
    expect(
      withoutLangyPromptLink({ search: "?langyConversation=c1&langy=open&langyPrompt=" }),
    ).toBe("?langyConversation=c1");
  });

  it("drops a langyConversation link the question supersedes", () => {
    expect(
      withoutLangyPromptLink({ search: "?langyConversation=c1&langyPrompt=hi&tab=traces" }),
    ).toBe("?tab=traces");
  });
});
