import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL } from "../constants";
import { getAllModels, getModelById } from "~/server/modelProviders/registry";

/**
 * Guard so the platform default prompt model can never silently go stale.
 * A new project / new prompt inherits DEFAULT_MODEL when nothing else is set,
 * so it must always point at a current, registry-served model — not a legacy
 * gpt-4 generation, and not behind the newest OpenAI flagship.
 */
describe("prompt sync fidelity — default prompt model", () => {
  /** @scenario The default prompt model is a current model the registry still serves */
  it("is a current model the registry still serves and not a legacy gpt-4 generation", () => {
    const entry = getModelById(DEFAULT_MODEL);
    expect(entry, `${DEFAULT_MODEL} is not in the model registry`).toBeTruthy();

    // Not a legacy gpt-4 / gpt-3.x generation (e.g. gpt-4o, gpt-4.1, gpt-3.5)
    expect(DEFAULT_MODEL).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);

    // Must support modern structured outputs — the whole point of a current
    // default for prompts that return strict JSON.
    expect(entry!.supportedParameters).toEqual(
      expect.arrayContaining(["response_format"]),
    );

    // Auto-discovery enforcement: never fall behind the newest plain OpenAI
    // flagship (gpt-<major>.<minor>) the registry currently ships.
    const flagshipVersion = (id: string): [number, number] | null => {
      const m = /^openai\/gpt-(\d+)\.(\d+)$/.exec(id);
      return m ? [Number(m[1]), Number(m[2])] : null;
    };

    let newest: [number, number] = [0, 0];
    for (const model of Object.values(getAllModels())) {
      if (model.provider !== "openai" || model.mode !== "chat") continue;
      const v = flagshipVersion(model.id);
      if (!v) continue;
      if (v[0] > newest[0] || (v[0] === newest[0] && v[1] > newest[1])) {
        newest = v;
      }
    }

    const current = flagshipVersion(DEFAULT_MODEL);
    expect(
      current,
      `${DEFAULT_MODEL} should be a plain gpt-<major>.<minor> flagship`,
    ).toBeTruthy();
    const isAtLeastAsNew =
      current![0] > newest[0] ||
      (current![0] === newest[0] && current![1] >= newest[1]);
    expect(
      isAtLeastAsNew,
      `DEFAULT_MODEL ${DEFAULT_MODEL} is behind the newest registry flagship openai/gpt-${newest[0]}.${newest[1]}`,
    ).toBe(true);
  });
});
