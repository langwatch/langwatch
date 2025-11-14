#!/usr/bin/env tsx
/**
 * Git Commit Log Generator
 * Outputs commit information in a simple text format
 * Usage: tsx scripts/git-activity-report.ts
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";

// Configuration constants
const AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || execSync("git config user.email", { encoding: "utf-8" }).trim();
const REPO_PATH = process.cwd();

// Date range constants
const REPORT_START_DATE = "2025-11-01T00:00:00";
const REPORT_END_DATE = "2025-11-30T23:59:59";

interface Commit {
  hash: string;
  branch: string;
  date: Date;
  subject: string;
  body: string;
  files: string[];
}

function getGitCommits(startDate: string, endDate: string, authorEmail: string): string {
  // Get commits with branch information - use git branch --contains to find branches for each commit
  const commitHashes = execSync(
    `git log --author="${authorEmail}" --since="${startDate}" --until="${endDate}" --all --pretty=format:"%H" --no-merges`,
    { cwd: REPO_PATH, encoding: "utf-8" }
  ).trim().split('\n').filter(Boolean);

  const commits: string[] = [];

  for (const hash of commitHashes) {
    try {
      // Get commit details
      const commitInfo = execSync(
        `git log --pretty=format:"%H|%ad|%s" --date=iso --name-only -1 ${hash}`,
        { cwd: REPO_PATH, encoding: "utf-8" }
      );

      // Get branch information
      const branches = execSync(
        `git branch --contains ${hash} --format="%(refname:short)" | head -5`,
        { cwd: REPO_PATH, encoding: "utf-8" }
      ).trim().split('\n').filter(Boolean);

      const branchInfo = branches.length > 0 ? branches.join(',') : 'unknown';
      const commitWithBranch = commitInfo.replace(hash, `${hash}|${branchInfo}`);

      commits.push(commitWithBranch);
    } catch (error) {
      // Fallback if branch lookup fails
      const commitInfo = execSync(
        `git log --pretty=format:"%H|unknown|%ad|%s" --date=iso --name-only -1 ${hash}`,
        { cwd: REPO_PATH, encoding: "utf-8" }
      );
      commits.push(commitInfo);
    }
  }

  return commits.join('\n\n');
}

function parseCommits(gitOutput: string): Commit[] {
  const commits: Commit[] = [];
  const commitBlocks = gitOutput.trim().split('\n\n');

  for (const block of commitBlocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    const [hash, branch, dateStr, fullMessage] = lines[0].split('|');

    // Split message into subject (first line) and body (remaining lines)
    const messageLines = fullMessage.split('\n');
    const subject = messageLines[0] || '';
    const body = messageLines.slice(1).join('\n').trim();

    const files: string[] = [];

    // Collect files from remaining lines
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        files.push(lines[i].trim());
      }
    }

    commits.push({
      hash,
      branch: branch || 'unknown',
      date: new Date(dateStr.trim()),
      subject,
      body,
      files,
    });
  }

  return commits;
}

function formatTimeDiff(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatHumanDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function formatHumanTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function generateSimpleReport(commits: Commit[]): string {
  // Filter commits to only November 2025
  const novemberCommits = commits.filter(commit => {
    const date = commit.date;
    return date.getFullYear() === 2025 && date.getMonth() === 10; // November is month 10 (0-indexed)
  });

  // Group commits by date
  const commitsByDate: Record<string, Commit[]> = {};
  for (const commit of novemberCommits) {
    const dateStr = commit.date.toISOString().split("T")[0];
    commitsByDate[dateStr] = commitsByDate[dateStr] || [];
    commitsByDate[dateStr].push(commit);
  }

  // Sort dates
  const sortedDates = Object.keys(commitsByDate).sort();

  const report: string[] = [];

  for (const dateStr of sortedDates) {
    const dayCommits = commitsByDate[dateStr].sort((a, b) => a.date.getTime() - b.date.getTime());

    const firstCommit = dayCommits[0];
    const humanDate = formatHumanDate(firstCommit.date);
    const isoDate = firstCommit.date.toISOString().split('T')[0];
    const humanStartTime = formatHumanTime(firstCommit.date);
    const isoStartTime = firstCommit.date.toISOString();

    report.push(`${humanDate} (${isoDate})\n\n`);

    for (let i = 0; i < dayCommits.length; i++) {
      const commit = dayCommits[i];

      report.push(`${humanDate} (${commit.date.toISOString().split('T')[0]})\n`);
      report.push(`Branch: ${commit.branch}\n`);
      report.push(`Commit Date: ${commit.date.toISOString().split('T')[0]}\n`);
      report.push(`Commit Message: ${commit.subject}\n`);
      report.push(`Commit Hash: ${commit.hash.slice(0, 8)}\n`);
      report.push(`Commit Timestamp: ${commit.date.toISOString()}\n`);

      if (commit.body) {
        report.push(`Commit Description: ${commit.body}\n`);
      }

      if (commit.files.length > 0) {
        report.push(`Files:\n`);
        report.push("     " + commit.files.join("\n     ") + "\n");
      }

      report.push("\n------\n");
    }

    report.push("\n");
  }

  return report.join("");
}

function main() {
  if (!AUTHOR_EMAIL) {
    console.error("Error: Set GIT_AUTHOR_EMAIL environment variable");
    process.exit(1);
  }

  console.log(`Fetching commits for ${AUTHOR_EMAIL} from ${REPORT_START_DATE} to ${REPORT_END_DATE}...`);

  const gitOutput = getGitCommits(REPORT_START_DATE, REPORT_END_DATE, AUTHOR_EMAIL);
  const commits = parseCommits(gitOutput);

  console.log(`Found ${commits.length} commits`);

  if (commits.length === 0) {
    console.log("No commits found for specified period");
    return;
  }

  console.log("Generating simple commit log...");
  const report = generateSimpleReport(commits);

  // Count actual November commits
  const novemberCommits = commits.filter(commit => {
    const date = commit.date;
    return date.getFullYear() === 2025 && date.getMonth() === 10;
  });
  console.log(`Filtered to ${novemberCommits.length} November 2025 commits`);

  const outputFile = `${REPO_PATH}/git-commits-${REPORT_START_DATE}-to-${REPORT_END_DATE}.txt`;
  writeFileSync(outputFile, report);

  console.log(`\nReport saved to: ${outputFile}`);
  console.log(`\nPreview:\n${report.split('\n').slice(0, 20).join('\n')}...`);
}

main();

