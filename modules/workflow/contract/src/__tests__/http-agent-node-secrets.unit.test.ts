import type { HttpAgentConfig } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import {
  dslWithStoredHttpAgentSecrets,
  dslWithoutHttpAgentSecrets,
  dslWithoutHttpCredentials,
  findOrigins,
  httpAgentIdsOf,
  isSameOrigin,
} from "../http-agent-node-secrets.ts";

const httpNode = (
  id: string,
  agent: string | undefined,
  authType: string,
  url = "https://agent.example/chat",
) => ({
  id,
  data: {
    ...(agent ? { agent } : {}),
    parameters: [
      { identifier: "agent_type", type: "str", value: "http" },
      { identifier: "auth_type", type: "str", value: authType },
      { identifier: "auth_token", type: "str", value: "node-token" },
      { identifier: "url", type: "str", value: url },
    ],
  },
});

const stored: HttpAgentConfig = {
  url: "https://agent.example",
  method: "POST",
  auth: { type: "bearer", token: "stored-token" },
};

describe("saved HTTP agent nodes in a graph", () => {
  it("names each saved HTTP agent once and ignores inline nodes", () => {
    const nodes = [
      httpNode("a", "agents/agent-1", "bearer"),
      httpNode("b", "agents/agent-1", "bearer"),
      httpNode("c", undefined, "bearer"),
    ];

    expect(httpAgentIdsOf(nodes)).toEqual(["agent-1"]);
  });

  /** @scenario Saving a graph leaves a saved HTTP agent's credentials with the agent */
  it("blanks a literal credential on a saved agent's node and on an inline node", () => {
    const dsl = {
      nodes: [httpNode("a", "agents/agent-1", "bearer"), httpNode("c", undefined, "bearer")],
    };

    const blanked = dslWithoutHttpAgentSecrets(dsl);

    expect(blanked.nodes[0]).toMatchObject({
      data: { parameters: [{}, { value: "bearer" }, { identifier: "auth_token", value: "" }, {}] },
    });
    expect(blanked.nodes[1]).toMatchObject({
      data: { parameters: [{}, {}, { identifier: "auth_token", value: "" }, {}] },
    });
  });

  it("keeps a secret reference, which names a secret and holds none", () => {
    const dsl = {
      nodes: [
        {
          id: "d",
          data: {
            parameters: [
              { identifier: "agent_type", type: "str", value: "http" },
              { identifier: "auth_token", type: "str", value: "{{ secrets.PARTNER }}" },
            ],
          },
        },
      ],
    };

    expect(dslWithoutHttpAgentSecrets(dsl)).toEqual(dsl);
  });

  /** @scenario A run fills a saved HTTP agent's blank credentials from the agent */
  it("fills a blank credential only where the auth kind is the stored agent's", () => {
    const blank = dslWithoutHttpAgentSecrets({
      nodes: [httpNode("a", "agents/agent-1", "bearer"), httpNode("b", "agents/agent-1", "basic")],
    });

    const filled = dslWithStoredHttpAgentSecrets({
      dsl: blank,
      stored: new Map([["agent-1", stored]]),
    });

    expect(filled.nodes[0]).toMatchObject({
      data: { parameters: [{}, {}, { identifier: "auth_token", value: "stored-token" }, {}] },
    });
    expect(filled.nodes[1]).toMatchObject({
      data: { parameters: [{}, {}, { identifier: "auth_token", value: "" }, {}] },
    });
  });

  /** @scenario A run fills a saved HTTP agent's credentials only at the agent's saved address */
  it("fills nothing on a node that calls another address than the agent's", () => {
    const blank = dslWithoutHttpAgentSecrets({
      nodes: [httpNode("a", "agents/agent-1", "bearer", "https://elsewhere.example/chat")],
    });

    const filled = dslWithStoredHttpAgentSecrets({
      dsl: blank,
      stored: new Map([["agent-1", stored]]),
    });

    expect(JSON.stringify(filled)).not.toContain("stored-token");
  });

  /** @scenario A graph copied into another project arrives with blank HTTP credentials */
  it("blanks every credential, references too, on a graph copied into another project", () => {
    const copied = dslWithoutHttpCredentials({
      nodes: [
        {
          id: "d",
          type: "http",
          data: {
            parameters: [{ identifier: "auth_token", type: "str", value: "{{ secrets.PARTNER }}" }],
          },
        },
      ],
    });

    expect(JSON.stringify(copied)).not.toContain("PARTNER");
  });
});

describe("isSameOrigin", () => {
  const saved = "https://agent.test/chat";

  it.each([
    ["another path", "https://agent.test/v2?x=1"],
    ["a differently cased host", "https://AGENT.test/chat"],
    ["the default port spelled out", "https://agent.test:443/chat"],
  ])("accepts %s", (_name, requested) => {
    expect(isSameOrigin({ requested, saved })).toBe(true);
  });

  it.each([
    ["another host", "https://other.test/chat"],
    ["a subdomain", "https://sub.agent.test/chat"],
    ["another scheme", "http://agent.test/chat"],
    ["another port", "https://agent.test:8443/chat"],
    ["a host that only starts with the saved one", "https://agent.test.evil.test/chat"],
    ["an address that is not a URL", "not a url"],
    [
      "a reference in the userinfo, resolved only when called",
      "https://{{ secrets.H }}@agent.test/chat",
    ],
  ])("rejects %s", (_name, requested) => {
    expect(isSameOrigin({ requested, saved })).toBe(false);
  });

  it("rejects when the saved address is not a URL", () => {
    expect(isSameOrigin({ requested: saved, saved: "{{ url }}" })).toBe(false);
  });

  it("accepts an address written exactly as the saved one, which resolves the same", () => {
    const templated = "{{ secrets.BASE_URL }}/chat";

    expect(isSameOrigin({ requested: templated, saved: templated })).toBe(true);
  });
});

describe("findOrigins", () => {
  it("answers the scheme, host and port a fixed address calls", () => {
    expect(findOrigins("https://Agent.test:443/chat?x=1")).toEqual(["https://agent.test"]);
  });

  it.each([
    ["a template in the host", "https://{{region}}.agent.test/chat"],
    ["a reference in the userinfo", "https://{{ secrets.H }}@agent.test/chat"],
    ["an address that is not a URL", "{{ secrets.BASE_URL }}/chat"],
  ])("answers none for %s", (_name, url) => {
    expect(findOrigins(url)).toEqual([]);
  });
});
