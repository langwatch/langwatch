import { describe, expect, it } from "vitest";

import {
  experimentRowWithoutHttpCredentials,
  normalizeWorkbenchState,
  workbenchStateWithoutHttpCredentials,
} from "../experiment-workbench-version.ts";
import { httpConfigSchema } from "../experiment-workbench.ts";

const oldHttpConfig = {
  url: "https://agent.example/chat",
  method: "POST",
  headers: [{ key: "x-tenant", value: "tenant-secret" }],
  auth: { type: "bearer", token: "token-secret" },
  bodyTemplate: '{"q":"{{input}}"}',
};

const oldState = {
  name: "Experiment",
  targets: [
    { id: "target-1", type: "agent", dbAgentId: "agent-1", httpConfig: oldHttpConfig },
    { id: "target-2", type: "prompt" },
  ],
};

describe("saved HTTP targets and credentials", () => {
  /** @scenario A saved HTTP agent target keeps no credentials in the experiment's saved state */
  it("drops headers and authentication when an HTTP config is written", () => {
    const written = httpConfigSchema.parse(oldHttpConfig);

    expect(written).toEqual({
      url: "https://agent.example/chat",
      method: "POST",
      bodyTemplate: '{"q":"{{input}}"}',
    });
  });

  /** @scenario Reading an experiment never returns credentials an older saved state holds */
  it("drops the dead copy from a saved state and keeps the rest of the target", () => {
    const read = workbenchStateWithoutHttpCredentials(oldState);

    expect(JSON.stringify(read)).not.toContain("tenant-secret");
    expect(JSON.stringify(read)).not.toContain("token-secret");
    expect(read).toMatchObject({
      targets: [
        {
          id: "target-1",
          dbAgentId: "agent-1",
          httpConfig: { url: "https://agent.example/chat", bodyTemplate: '{"q":"{{input}}"}' },
        },
        { id: "target-2", type: "prompt" },
      ],
    });
  });

  /** @scenario Reading an experiment never returns credentials an older saved state holds */
  it("drops it from an experiment row and from a normalised workbench read", () => {
    const row = experimentRowWithoutHttpCredentials({
      id: "experiment-1",
      workbenchState: oldState,
    });

    expect(JSON.stringify(row)).not.toContain("token-secret");
    expect(JSON.stringify(normalizeWorkbenchState(oldState))).not.toContain("tenant-secret");
    expect(experimentRowWithoutHttpCredentials({ id: "e", workbenchState: null })).toEqual({
      id: "e",
      workbenchState: null,
    });
  });
});
