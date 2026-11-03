import { describe, expect, it, vi } from "vitest";

const calls: { command: string; args: string[] }[] = [];

// One process listens on 5560 (IPv4) and on [::1]:5560; another on a port no slot uses.
const LSOF_OUTPUT = [
  "p4242",
  "f12",
  "n*:5560",
  "f13",
  "n[::1]:5560",
  "p77",
  "f3",
  "n127.0.0.1:9999",
].join("\n");

vi.mock("execa", () => ({
  execa: vi.fn(async (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === "lsof") return { stdout: LSOF_OUTPUT };
    if (command === "ps") return { stdout: "node dev-server.js" };
    return { stdout: "" };
  }),
}));

const { detectConflicts } = await import("../src/port-conflict/detect.ts");

describe("the port check before starting", () => {
  describe("when another process listens on one of the ports", () => {
    /** @scenario "The port check asks the system once" */
    it("asks lsof once for every listening port, names the holder and suggests the next slot", async () => {
      const report = await detectConflicts(5560);

      expect(calls.filter((call) => call.command === "lsof")).toEqual([
        { command: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"] },
      ]);
      expect(report.conflicts).toEqual([
        { port: 5560, label: "langwatch", pid: 4242, command: "node dev-server.js" },
      ]);
      expect(report.suggestedBase).toBe(5570);
    });
  });
});
