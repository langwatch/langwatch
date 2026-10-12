import { z } from "zod/mini";

import { MockDocsTokenProvider } from "./mock-token-provider.ts";
import { DocsSessionController } from "./session-controller.ts";

// Mini ships no English messages; this keeps the one a misconfigured build shows.
const sessionModeSchema = z._default(
  z.enum(["off", "mock"], { error: 'Invalid option: expected one of "off"|"mock"' }),
  "off",
);

export function createDocsSession({ mode }: { mode?: string }) {
  if (sessionModeSchema.parse(mode) === "off") return null;
  return DocsSessionController.create({ provider: MockDocsTokenProvider.create() });
}
