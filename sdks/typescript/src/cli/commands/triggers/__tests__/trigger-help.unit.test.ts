import { describe, expect, it } from "vitest";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// absent under vitest; provide it before the dynamic import below.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const optionHelp = async ({
  command,
  flag,
}: {
  command: string;
  flag: string;
}): Promise<string | undefined> => {
  const { buildProgram } = await import("../../../program.js");
  const trigger = buildProgram().commands.find((c) => c.name() === "trigger");
  const sub = trigger?.commands.find((c) => c.name() === command);
  return sub?.options.find((o) => o.long === flag)?.description;
};

describe("Feature: trigger flags explain themselves", () => {
  for (const command of ["create", "update"]) {
    describe(`when reading \`trigger ${command} --help\``, () => {
      it("states the nested shape for keyed filters, keyed by monitor id", async () => {
        const help = await optionHelp({ command, flag: "--filters" });

        expect(help).toContain('{"evaluations.passed":{"<monitorId>":["false"]}}');
        expect(help).toContain('{"metadata.value":{"<key>":["true"]}}');
        expect(help).toContain("MONITOR id");
      });

      it("offers the alert and report flags", async () => {
        for (const flag of ["--graph-alert", "--report", "--filter-query"]) {
          expect(await optionHelp({ command, flag })).toBeDefined();
        }
      });
    });
  }

  it("picks an alert's graph only when it is created", async () => {
    expect(await optionHelp({ command: "create", flag: "--custom-graph-id" })).toBeDefined();
    expect(await optionHelp({ command: "update", flag: "--custom-graph-id" })).toBeUndefined();
  });

  it("lets `trigger fires` resume from a cursor", async () => {
    expect(await optionHelp({ command: "fires", flag: "--cursor" })).toBeDefined();
  });
});
