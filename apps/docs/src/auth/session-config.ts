import { z } from "zod";

import { MockDocsTokenProvider } from "./mock-token-provider.ts";
import { DocsSessionController } from "./session-controller.ts";

const sessionModeSchema = z.enum(["off", "mock"]).default("off");

export function createDocsSession({ mode }: { mode?: string }) {
  if (sessionModeSchema.parse(mode) === "off") return null;
  return DocsSessionController.create({ provider: MockDocsTokenProvider.create() });
}
