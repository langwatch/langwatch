/**
 * The seam between what the gateway posts and what the pipeline appends.
 *
 * Two shapes have to keep agreeing across a deploy: the wire schema, which
 * the Go emitter is built against and must not grow requirements, and the
 * command schema, which is what already-appended events are read back
 * through. A field added to the command schema without a default turns
 * every event written before the deploy into a parse failure, so the
 * defaults are the compatibility contract and are pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  admitSpendCommandDataSchema,
  admitSpendWireSchema,
} from "../schemas/commands";

/** Exactly what the Go emitter sends, mapped through the ingest route. */
const wireAdmission = {
  gateway_request_id: "req_01J",
  occurred_at: Date.UTC(2026, 6, 21, 9, 0, 0),
  organization_id: "org_1",
  tenantId: "proj_1",
  virtual_key_id: "vk_1",
  model: "gpt-x",
};

describe("spend command schemas", () => {
  it("accepts the gateway's admission without the attribution the seam adds", () => {
    const parsed = admitSpendWireSchema.parse(wireAdmission);

    expect(parsed.principal_user_id).toBe("");
    expect(parsed.end_user_id).toBe("");
    expect(parsed.model_provider_id).toBe("");
  });

  it("reads an admission appended before the team was carried", () => {
    // A pre-deploy event, replayed by a post-deploy consumer: the enriched
    // field has to default rather than fail the read.
    const parsed = admitSpendCommandDataSchema.parse(wireAdmission);

    expect(parsed.team_id).toBe("");
  });

  it("keeps the enriched attribution when the seam supplied it", () => {
    const parsed = admitSpendCommandDataSchema.parse({
      ...wireAdmission,
      team_id: "team_1",
      principal_user_id: "usr_1",
    });

    expect(parsed).toMatchObject({
      team_id: "team_1",
      principal_user_id: "usr_1",
    });
  });
});
