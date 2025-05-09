import Redis from "ioredis";
import { collectorQueue } from "../server/background/queues/collectorQueue";

export default async function execute() {
  const activeJobs = await collectorQueue.getJobs(["active"]);
  console.log("Active jobs:", activeJobs);
  // const client = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

  // // await client.ping();
  // // console.log('PING response OK.');

  // const queueName = "collector";

  // const activeJobIds = await client.lrange(`bull:${queueName}:active`, 0, -1);

  // console.log("Active job IDs:", activeJobIds);

  // for (const jobId of activeJobIds) {
  //   // Remove lock and then job
  //   await client.del(`bull:${queueName}:${jobId}:lock`);
  //   console.log(`Removed job ${jobId}`);
  // }
}
