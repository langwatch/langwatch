/**
 * The telemetry ops functions (ADR-202): the shared ClickHouse's failed statements and its
 * health. Shapes, sources, codes, counts and times only; never a statement's text.
 * Spec: modules/staff-access/specs/staff-access-functions-telemetry.feature
 */
import { z } from "zod";

import {
  entry,
  isoTime,
  pageInput,
  rangeInput,
  staffAccessPageSchema,
  type StaffAccessFunctionEntry,
} from "./staff-access-function-shapes.ts";

const querySource = z.enum(["lwql", "dashboard", "instant_eval", "trace_list", "facet", "other"]);

export const STAFF_ACCESS_TELEMETRY_FUNCTIONS = {
  "ch.query_errors": entry({
    title: "Failed ClickHouse statements by shape, source and error code",
    scope: "platform",
    answers:
      "Which product reads fail in ClickHouse, with which error, how often, and for which projects.",
    input: z
      .object({
        /** Start of the range; at most 7 days before `until`. */
        since: rangeInput.since,
        until: rangeInput.until,
        /** ClickHouse's numeric error code, such as 241 for a memory limit. */
        code: z.number().int().nonnegative().optional(),
        source: querySource.optional(),
        ...pageInput,
      })
      .strict(),
    output: staffAccessPageSchema(
      z
        .object({
          queryShapeId: z.string(),
          source: querySource,
          code: z.number().int(),
          codeName: z.string(),
          count: z.number().int(),
          p95Ms: z.number(),
          maxMemoryBytes: z.number(),
          rowsRead: z.number(),
          projectIds: z.array(z.string()),
          lastAt: isoTime,
        })
        .strict(),
    ),
  }),
  "ch.health": entry({
    title: "ClickHouse replicas, parts, merges, disks and memory",
    scope: "platform",
    answers:
      "Whether ClickHouse is short of disk or memory, lagging replicas, or drowning in parts.",
    input: z.object({ ...pageInput }).strict(),
    output: z
      .object({
        nodes: z.number().int(),
        replicas: z
          .object({
            tables: z.number().int(),
            readonly: z.number().int(),
            sessionExpired: z.number().int(),
            maxDelaySeconds: z.number(),
            maxQueueSize: z.number().int(),
          })
          .strict(),
        merges: z
          .object({
            running: z.number().int(),
            longestSeconds: z.number(),
            pendingMutations: z.number().int(),
          })
          .strict(),
        disks: z
          .object({
            count: z.number().int(),
            totalBytes: z.number(),
            freeBytes: z.number(),
            lowestFreeRatio: z.number(),
          })
          .strict(),
        memory: z.object({ residentBytes: z.number(), totalBytes: z.number() }).strict(),
        tables: staffAccessPageSchema(
          z
            .object({
              table: z.string(),
              activeParts: z.number().int(),
              maxPartsInPartition: z.number().int(),
              bytesOnDisk: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;
