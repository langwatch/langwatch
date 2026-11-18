/**
 * The api's insert-only writer in the access model and the upgrade's walk (ADR-202 Decided 12):
 * INSERT on three tables, no SELECT, rendered by both emitters, provisioned beside each reader.
 * @see specs/clickhouse/app-writer-identity.feature
 */
import { createHash } from "node:crypto";

import {
  APP_WRITER_NAMES,
  renderAppReaderDdl,
  renderAppReaderUsersD,
} from "@langwatch/clickhouse-migrations";
import { describe, expect, it } from "vitest";

import { appWriterInputOf, planAppReaderWalk } from "../lwql-provision.task.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const SHARED_ADMIN = "http://default:admin@shared.invalid:8123/langwatch";
const SHARED_READER = "http://langwatch_app_reader:reader@shared.invalid:8123/langwatch";
const SHARED_WRITER = "http://langwatch_app_writer:wr%40ter@shared.invalid:8123/langwatch";
const ONE_ADMIN = "http://default:one-admin@one.invalid:8123/tenantdb";
const ONE_READER = "http://langwatch_app_reader:one@one.invalid:8123/tenantdb";
const ONE_WRITER = "http://langwatch_app_writer:one-writer@one.invalid:8123/tenantdb";

const INPUT = {
  sourceDatabase: "langwatch",
  appReader: { passwordSha256Hex: sha256("reader") },
  appWriter: { passwordSha256Hex: sha256("writer") },
};

const WRITER_GRANTS = [
  "GRANT INSERT ON langwatch.gateway_budget_ledger_events TO langwatch_app_writer",
  "GRANT INSERT ON langwatch.dspy_steps TO langwatch_app_writer",
  "GRANT INSERT ON langwatch.instant_eval_runs TO langwatch_app_writer",
];

describe("the writer in the access model", () => {
  /** @scenario "The writer holds INSERT on the three api tables and no SELECT grant" */
  it("grants INSERT on the three tables alone and hides its query log", () => {
    const writerDdl = renderAppReaderDdl(INPUT).filter((statement) =>
      statement.includes(APP_WRITER_NAMES.user),
    );

    expect(writerDdl.filter((statement) => statement.startsWith("GRANT"))).toEqual(WRITER_GRANTS);
    expect(writerDdl.some((statement) => /GRANT SELECT/.test(statement))).toBe(false);
    expect(writerDdl).toContain(
      "CREATE ROW POLICY OR REPLACE user_query_log_app_writer_hidden ON system.user_query_log\n" +
        "  USING 0\n  TO langwatch_app_writer",
    );
    expect(renderAppReaderDdl({ ...INPUT, appWriter: undefined })).toEqual(
      renderAppReaderDdl(INPUT).filter((statement) => !statement.includes(APP_WRITER_NAMES.user)),
    );
  });

  /** @scenario "Both emitters render the same writer" */
  it("renders the same user, profile and grants as users.d", () => {
    const usersD = renderAppReaderUsersD(INPUT).replaceAll(`"`, "");

    expect(usersD).toContain("langwatch_app_writer:");
    expect(usersD).toContain(`profile: ${APP_WRITER_NAMES.settingsProfile}`);
    for (const grant of WRITER_GRANTS) {
      expect(usersD).toContain(grant.replace(" TO langwatch_app_writer", ""));
    }
  });
});

describe("planAppReaderWalk() with the writer", () => {
  /** @scenario "Provisioning walks the writer to every server the reader is provisioned on" */
  it("provisions the shared server and each route with the writer's hash", () => {
    const walk = planAppReaderWalk({
      source: {
        CLICKHOUSE_URL: SHARED_ADMIN,
        CLICKHOUSE_READER_URL: SHARED_READER,
        CLICKHOUSE_WRITER_URL: SHARED_WRITER,
        CLICKHOUSE_URL__eu__org_1: ONE_ADMIN,
        CLICKHOUSE_READER_URL__eu__org_1: ONE_READER,
        CLICKHOUSE_WRITER_URL__eu__org_1: ONE_WRITER,
      },
    });

    expect(walk.unprovisioned).toEqual([]);
    expect(walk.targets.map((target) => [target.target, appWriterInputOf(target)])).toEqual([
      ["shared", { appWriter: { passwordSha256Hex: sha256("wr@ter") } }],
      ["org_1", { appWriter: { passwordSha256Hex: sha256("one-writer") } }],
    ]);
  });

  /** @scenario "A routed server without the writer's credential is named, and its reader still provisioned" */
  it("provisions the route's reader alone and names the writer variable to set", () => {
    const walk = planAppReaderWalk({
      source: {
        CLICKHOUSE_URL: SHARED_ADMIN,
        CLICKHOUSE_READER_URL: SHARED_READER,
        CLICKHOUSE_WRITER_URL: SHARED_WRITER,
        CLICKHOUSE_URL__eu__org_1: ONE_ADMIN,
        CLICKHOUSE_READER_URL__eu__org_1: ONE_READER,
      },
    });

    const routed = walk.targets.find((target) => target.target === "org_1");
    expect(routed?.readerPassword).toBe("one");
    expect(routed && appWriterInputOf(routed)).toEqual({});
    expect(walk.unprovisioned).toEqual([
      { target: "org_1", variable: "CLICKHOUSE_WRITER_URL__eu__org_1" },
    ]);
  });

  /** @scenario "A writer credential with no reader credential is named, never provisioned alone" */
  it("names the shared server by CLICKHOUSE_READER_URL and provisions nothing", () => {
    const walk = planAppReaderWalk({
      source: { CLICKHOUSE_URL: SHARED_ADMIN, CLICKHOUSE_WRITER_URL: SHARED_WRITER },
    });

    expect(walk).toEqual({
      targets: [],
      unprovisioned: [{ target: "shared", variable: "CLICKHOUSE_READER_URL" }],
    });
  });
});
