import chalk from "chalk";
import Table from "cli-table3";
import type IORedis from "ioredis";
import { getAllQueueStats } from "../lib/queues.js";

export async function listQueues(connection: IORedis): Promise<void> {
  console.log(chalk.blue("\n📋 Discovering queues...\n"));

  const stats = await getAllQueueStats(connection);

  if (stats.length === 0) {
    console.log(chalk.yellow("No queues found."));
    return;
  }

  const table = new Table({
    head: [
      chalk.white("Queue"),
      chalk.cyan("Waiting"),
      chalk.green("Active"),
      chalk.blue("Completed"),
      chalk.red("Failed"),
      chalk.yellow("Delayed"),
      chalk.gray("Paused"),
    ],
    colAligns: ["left", "right", "right", "right", "right", "right", "right"],
  });

  for (const stat of stats) {
    table.push([
      stat.name,
      stat.waiting > 0 ? chalk.cyan(stat.waiting) : stat.waiting,
      stat.active > 0 ? chalk.green(stat.active) : stat.active,
      stat.completed,
      stat.failed > 0 ? chalk.red(stat.failed) : stat.failed,
      stat.delayed > 0 ? chalk.yellow(stat.delayed) : stat.delayed,
      stat.paused > 0 ? chalk.gray(stat.paused) : stat.paused,
    ]);
  }

  console.log(table.toString());
  console.log(
    chalk.gray(`\nTotal queues: ${stats.length}`)
  );
}
