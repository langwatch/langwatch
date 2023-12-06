import { Queue } from "bullmq";
import { connection } from "../server/redis";
import { captureError } from "../utils/captureError";
import { esClient, TRACE_CHECKS_INDEX } from "../server/elasticsearch";
import type { TraceCheck } from "../server/tracer/types";
import type { CategorizationJob, CheckTypes, TraceCheckJob } from "./types";
import crypto from "crypto";
import { prisma } from "../server/db";

const traceChecksQueue = new Queue<TraceCheckJob, any, string>("trace_checks", {
  connection,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

const categorizationQueue = new Queue<CategorizationJob, void, string>(
  "categorization",
  {
    connection,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  }
);

export const scheduleTraceCheck = async ({
  check_id,
  check_type,
  check_name,
  trace_id,
  project_id,
  delay,
}: {
  check_id: string;
  check_type: CheckTypes;
  check_name: string;
  trace_id: string;
  project_id: string;
  delay?: number;
}) => {
  await updateCheckStatusInES({
    check_id,
    check_type,
    check_name,
    trace_id,
    project_id,
    status: "scheduled",
  });

  await traceChecksQueue.add(
    check_type,
    { check_id, trace_id, project_id },
    {
      jobId: `trace_check_${trace_id}/${check_id}`,
      delay: delay ?? 5000,
      attempts: 3,
    }
  );
};

export const updateCheckStatusInES = async ({
  check_id,
  check_type,
  check_name,
  trace_id,
  project_id,
  status,
  raw_result,
  value,
  error,
  retries,
}: {
  check_id: string;
  check_type: CheckTypes;
  check_name?: string;
  trace_id: string;
  project_id: string;
  status: TraceCheck["status"];
  error?: any;
  raw_result?: object;
  value?: number;
  retries?: number;
}) => {
  const traceCheck: TraceCheck = {
    id: `trace_check_${trace_id}/${check_id}`,
    trace_id,
    project_id,
    check_id,
    check_type,
    status,
    ...(check_name && { check_name }),
    ...(raw_result && { raw_result }),
    ...(value && { value }),
    ...(error && { error: captureError(error) }),
    ...(retries && { retries }),
    timestamps: {
      ...(status == "in_progress" && { started_at: Date.now() }),
      ...((status == "succeeded" || status == "failed") && {
        finished_at: Date.now(),
      }),
    },
  };

  await esClient.update({
    index: TRACE_CHECKS_INDEX,
    id: traceCheck.id,
    body: {
      doc: traceCheck,
      upsert: {
        ...traceCheck,
        timestamps: {
          ...traceCheck.timestamps,
          inserted_at: Date.now(),
        },
      },
    },
    refresh: true,
  });
};

export const scheduleCategorization = async () => {
  const projects = await prisma.project.findMany({
    where: { firstMessage: true },
    select: { id: true },
  });

  const jobs = projects.map((project) => {
    const hash = crypto.createHash("sha256");
    hash.update(project.id);
    const hashedValue = hash.digest("hex");
    const hashNumber = parseInt(hashedValue, 16);
    const distributionHour = hashNumber % (24 * 60);
    const distributionMinute = hashNumber % 60;
    const yyyymmdd = new Date().toISOString().split("T")[0];

    return {
      name: "categorization",
      data: { project_id: project.id },
      opts: {
        jobId: `categorization_${project.id}_${yyyymmdd}`,
        delay:
          distributionHour * 60 * 60 * 1000 + distributionMinute * 60 * 1000,
        attempts: 3,
      },
    };
  });

  await categorizationQueue.addBulk(jobs);
};
