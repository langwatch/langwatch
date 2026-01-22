import chalk from "chalk";
import Table from "cli-table3";
import type IORedis from "ioredis";
import { getAllQueueStats, type QueueStats } from "../lib/queues.js";

export interface WatchOptions {
  interval?: number;
}

function clearScreen(): void {
  process.stdout.write("\x1B[2J\x1B[0f");
}

function formatDelta(current: number, previous: number): string {
  const delta = current - previous;
  if (delta === 0) return "";
  if (delta > 0) return chalk.green(` (+${delta})`);
  return chalk.red(` (${delta})`);
}

export async function watchQueues(
  connection: IORedis,
  options: WatchOptions = {}
): Promise<void> {
  const { interval = 2000 } = options;

  let previousStats: Map<string, QueueStats> = new Map();
  let iteration = 0;

  console.log(chalk.blue("Starting queue monitor. Press Ctrl+C to exit.\n"));

  const refresh = async (): Promise<void> => {
    try {
      const stats = await getAllQueueStats(connection);
      const currentStats = new Map(stats.map((s) => [s.name, s]));

      clearScreen();

      console.log(
        chalk.blue.bold("📊 BullMQ Queue Monitor") +
          chalk.gray(` (refreshing every ${interval / 1000}s)`)
      );
      console.log(chalk.gray(`Last update: ${new Date().toISOString()}\n`));

      if (stats.length === 0) {
        console.log(chalk.yellow("No queues found."));
      } else {
        const table = new Table({
          head: [
            chalk.white("Queue"),
            chalk.cyan("Waiting"),
            chalk.green("Active"),
            chalk.blue("Completed"),
            chalk.red("Failed"),
            chalk.yellow("Delayed"),
          ],
          colAligns: ["left", "right", "right", "right", "right", "right"],
        });

        for (const stat of stats) {
          const prev = previousStats.get(stat.name);

          table.push([
            stat.name,
            (stat.waiting > 0 ? chalk.cyan(stat.waiting) : String(stat.waiting)) +
              (prev ? formatDelta(stat.waiting, prev.waiting) : ""),
            (stat.active > 0 ? chalk.green(stat.active) : String(stat.active)) +
              (prev ? formatDelta(stat.active, prev.active) : ""),
            String(stat.completed) +
              (prev ? formatDelta(stat.completed, prev.completed) : ""),
            (stat.failed > 0 ? chalk.red(stat.failed) : String(stat.failed)) +
              (prev ? formatDelta(stat.failed, prev.failed) : ""),
            (stat.delayed > 0 ? chalk.yellow(stat.delayed) : String(stat.delayed)) +
              (prev ? formatDelta(stat.delayed, prev.delayed) : ""),
          ]);
        }

        console.log(table.toString());

        // Summary
        const totals = stats.reduce(
          (acc, s) => ({
            waiting: acc.waiting + s.waiting,
            active: acc.active + s.active,
            failed: acc.failed + s.failed,
          }),
          { waiting: 0, active: 0, failed: 0 }
        );

        console.log(
          chalk.gray(
            `\nTotal: ${totals.waiting} waiting, ${totals.active} active, ${totals.failed} failed`
          )
        );
      }

      previousStats = currentStats;
      iteration++;
    } catch (error) {
      console.error(chalk.red(`\nError refreshing: ${error}`));
    }
  };

  // Initial refresh
  await refresh();

  // Set up interval
  const intervalId = setInterval(refresh, interval);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    clearInterval(intervalId);
    console.log(chalk.gray("\n\nMonitor stopped."));
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {});
}
