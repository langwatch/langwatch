import { describe, expect, it, vi } from "vitest";
import {
  LangyMessageRepository,
  LangyMessageService,
} from "../LangyMessageService";

function makeRepo(overrides?: Partial<LangyMessageRepository>) {
  const repo = {
    findAllByConversation: vi.fn(),
    create: vi.fn(),
    ...overrides,
  } as unknown as LangyMessageRepository;
  return repo;
}

describe("LangyMessageService", () => {
  describe("when getRecordsByConversation flattens stored rows for the UI", () => {
    it("extracts text parts into a content string the sidebar can render", async () => {
      const repo = makeRepo({
        findAllByConversation: vi.fn().mockResolvedValue([
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
          {
            id: "m2",
            role: "assistant",
            parts: [
              { type: "text", text: "line one" },
              { type: "text", text: "line two" },
            ],
          },
        ]),
      });
      const svc = new LangyMessageService(repo);
      const records = await svc.getRecordsByConversation({
        conversationId: "c1",
        projectId: "p1",
      });
      expect(records).toEqual([
        { id: "m1", role: "user", content: "hello" },
        { id: "m2", role: "assistant", content: "line one\nline two" },
      ]);
    });

    it("yields empty content when a row has no text parts rather than throwing", async () => {
      const repo = makeRepo({
        findAllByConversation: vi.fn().mockResolvedValue([
          { id: "m1", role: "assistant", parts: [{ type: "tool-call" }] },
          { id: "m2", role: "user", parts: null },
        ]),
      });
      const svc = new LangyMessageService(repo);
      const records = await svc.getRecordsByConversation({
        conversationId: "c1",
        projectId: "p1",
      });
      expect(records).toEqual([
        { id: "m1", role: "assistant", content: "" },
        { id: "m2", role: "user", content: "" },
      ]);
    });
  });
});
