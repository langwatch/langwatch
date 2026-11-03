// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The claude_code export block both the inventory and the ingestion-source secret modals show. */
import { describe, expect, it } from "vitest";

import { buildClaudeCodeEnvBlock } from "../governance-inventory.screen.tsx";

describe("buildClaudeCodeEnvBlock", () => {
  const snippet = buildClaudeCodeEnvBlock({
    secret: "sk-lw-test",
    otlpUrl: "https://app.test/api/ingest/otel/src-1",
  });

  it("sets the four light claude OTEL_LOG_* content knobs, not raw bodies", () => {
    expect(snippet).toContain("export OTEL_LOG_USER_PROMPTS=1");
    expect(snippet).toContain("export OTEL_LOG_TOOL_DETAILS=1");
    expect(snippet).toContain("export OTEL_LOG_TOOL_CONTENT=1");
    expect(snippet).toContain("export OTEL_LOG_ASSISTANT_RESPONSES=1");
    expect(snippet).not.toContain("export OTEL_LOG_RAW_API_BODIES=1");
  });

  it("tells an upgrading user to drop the old raw-bodies line from their rc", () => {
    expect(snippet).toContain("Remove any older OTEL_LOG_RAW_API_BODIES=1 line from your shell rc");
  });

  it("interpolates the endpoint and secret", () => {
    expect(snippet).toContain(
      'export OTEL_EXPORTER_OTLP_ENDPOINT="https://app.test/api/ingest/otel/src-1"',
    );
    expect(snippet).toContain(
      'export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer sk-lw-test"',
    );
  });
});
