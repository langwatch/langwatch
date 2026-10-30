// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Ops screen's copy of the notices tRPC contract in ops-contract must match this one, field for
 * field, or the browser builds against a shape the server refuses.
 */
import { selfHostedNoticesTrpc as browserMirror } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { selfHostedNoticesTrpc } from "../self-hosted-notice.trpc.ts";

const shapeOf = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: "any" });

describe("the ops-contract mirror of selfHostedNoticesTrpc", () => {
  it("declares the same procedures with the same input and output", () => {
    const shapes = (
      members: Record<string, { kind: string; input: z.ZodType; output: z.ZodType }>,
    ) =>
      Object.entries(members).map(([name, { kind, input, output }]) => ({
        name,
        kind,
        input: shapeOf(input),
        output: shapeOf(output),
      }));
    expect(shapes(browserMirror.members)).toEqual(shapes(selfHostedNoticesTrpc.members));
  });
});
