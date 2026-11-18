import { describe, expect, it } from "vitest";

import {
  buildLangyPromptLink,
  findLangyPromptLink,
  withoutLangyPromptLink,
} from "../langy.deep-link.ts";

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

  it("drops a langyConversation link the question supersedes", () => {
    expect(
      withoutLangyPromptLink({ search: "?langyConversation=c1&langyPrompt=hi&tab=traces" }),
    ).toBe("?tab=traces");
  });
});

describe("buildLangyPromptLink", () => {
  it("adds the parameters before the Explorer's hash and round-trips the question", () => {
    const href = buildLangyPromptLink({
      path: "/acme/traces#all-traces?q=trace.attribute.laze.agent.id:agent_1",
      prompt: "What spent the most tokens & why?",
    });

    expect(href.endsWith("#all-traces?q=trace.attribute.laze.agent.id:agent_1")).toBe(true);
    const search = href.slice(href.indexOf("?"), href.indexOf("#"));
    expect(findLangyPromptLink({ search })).toEqual([
      { prompt: "What spent the most tokens & why?" },
    ]);
  });

  it("keeps every existing parameter, including values that hold a question mark", () => {
    const href = buildLangyPromptLink({ path: "/p?next=/a?x=1&tab=traces#frag", prompt: "hi" });
    const params = new URLSearchParams(href.slice(href.indexOf("?"), href.indexOf("#")));

    expect(params.get("next")).toBe("/a?x=1");
    expect(params.get("tab")).toBe("traces");
    expect(href.endsWith("#frag")).toBe(true);
  });
});
