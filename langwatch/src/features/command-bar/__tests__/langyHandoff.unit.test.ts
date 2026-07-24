import { describe, expect, it, vi } from "vitest";
import { beginLangyHandoff, LANGY_HANDOFF_DURATION_MS } from "../langyHandoff";

describe("beginLangyHandoff", () => {
  it("opens Langy before scheduling the command bar close", () => {
    const events: string[] = [];
    let scheduledClose: (() => void) | undefined;
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      events.push(`scheduled:${delayMs}`);
      scheduledClose = callback;
      return 41;
    });

    const timer = beginLangyHandoff({
      prompt: "inspect this trace",
      askLangy: (prompt) => events.push(`ask:${prompt}`),
      closeCommandBar: () => events.push("close"),
      reducedMotion: false,
      setExiting: (exiting) => events.push(`exiting:${exiting}`),
      schedule,
    });

    expect(timer).toBe(41);
    expect(events).toEqual([
      "exiting:true",
      "ask:inspect this trace",
      `scheduled:${LANGY_HANDOFF_DURATION_MS}`,
    ]);
    expect(schedule).toHaveBeenCalledTimes(1);

    scheduledClose?.();
    expect(events.at(-1)).toBe("close");
  });

  it("keeps the ordering but closes synchronously for reduced motion", () => {
    const events: string[] = [];
    const schedule = vi.fn(() => 1);

    const timer = beginLangyHandoff({
      prompt: "show failures",
      askLangy: (prompt) => events.push(`ask:${prompt}`),
      closeCommandBar: () => events.push("close"),
      reducedMotion: true,
      setExiting: (exiting) => events.push(`exiting:${exiting}`),
      schedule,
    });

    expect(timer).toBeNull();
    expect(events).toEqual(["ask:show failures", "close"]);
    expect(schedule).not.toHaveBeenCalled();
  });
});
