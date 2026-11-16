// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { buildTestCurl, type SecretDetails } from "../inventory/secret-modal-commands.ts";

/** Undoes POSIX single quoting of one argument, the way a shell reads it back. */
function readSingleQuotedArgument(quoted: string): string {
  expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
  const inner = quoted.slice(1, -1);
  expect(inner.replaceAll(`'\\''`, "")).not.toContain("'");
  return inner.replaceAll(`'\\''`, "'");
}

describe("given the test command a push source's secret dialog offers", () => {
  const details: SecretDetails = {
    title: "Ingest secret",
    secret: "lw_is_test_secret",
    sourceId: "src_otel",
    sourceName: "O'Brien's laptop",
    sourceType: "otel_generic",
  };

  /** @scenario "The test command survives an apostrophe in the source name" */
  it("keeps the body one shell argument that still names the source", () => {
    const curl = buildTestCurl({
      details,
      otlpUrl: "https://langwatch.invalid/api/ingest/otel/src_otel",
      webhookUrl: "",
      usesPushUrl: true,
      usesWebhookUrl: false,
    });

    const bodyLine = curl?.split("\n").find((line) => line.trimStart().startsWith("-d "));
    const body = JSON.parse(readSingleQuotedArgument(bodyLine!.trim().slice(3)));

    expect(body.resource_spans[0].resource.attributes[0].value.stringValue).toBe(
      "O'Brien's laptop",
    );
  });
});
