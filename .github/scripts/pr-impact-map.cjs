// The PR impact map comment, run by pr.yml's checks job through actions/github-script.
// Moved out of the old pr-impact-map.yml as it was; Spec: specs/ci/quiet-branch.feature
module.exports = async ({ github, context, core }) => {
  const MARKER = "<!-- pr-impact-map -->";

  const { classify, generatedMatcher, moduleOf } = require(
    `${process.env.GITHUB_WORKSPACE}/.github/scripts/pr-impact-map-categories.cjs`,
  );
  const { execFileSync } = require("node:child_process");
  const { readFileSync } = require("node:fs");
  const isGenerated = generatedMatcher(
    readFileSync(`${process.env.GITHUB_WORKSPACE}/.gitattributes`, "utf8"),
  );

  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;
  const shortSha = pr.head.sha.slice(0, 7);

  // `git diff --numstat` counts every file. The pulls/files API caps
  // at 3000, and large restructures exceed it. -z keeps odd paths
  // intact; binary files report "-" and count as zero lines.
  const out = execFileSync(
    "git",
    ["diff", "--numstat", "-z", "--no-renames", `${pr.base.sha}...${pr.head.sha}`],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  );
  const files = out
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [adds, dels, ...rest] = entry.split("\t");
      return {
        filename: rest.join("\t"),
        additions: Number(adds) || 0,
        deletions: Number(dels) || 0,
      };
    });
  const totalAdditions = files.reduce((n, f) => n + f.additions, 0);
  const totalDeletions = files.reduce((n, f) => n + f.deletions, 0);

  const buckets = new Map();
  const modules = new Map();
  const add = (map, key, file) => {
    const bucket = map.get(key) ?? { files: 0, additions: 0, deletions: 0 };
    bucket.files += 1;
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
    map.set(key, bucket);
  };
  for (const file of files) {
    add(buckets, classify(file.filename, { isGenerated }), file);
    const mod = moduleOf(file.filename);
    if (mod) add(modules, mod, file);
  }

  const num = (n) => n.toLocaleString("en-US");
  const rows = [...buckets.entries()].sort((a, b) => b[1].files - a[1].files);

  let body;
  if (files.length === 0) {
    body = [MARKER, "### PR Impact Map", "", "No files changed."].join("\n");
  } else {
    // Share is by file count, not lines: lockfiles and generated code
    // dominate line counts and would make every dep bump look like a
    // rewrite.
    const BAR_WIDTH = 15;
    const bar = (share) => {
      const filled = Math.round(share * BAR_WIDTH);
      return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    };

    const table = rows.map(([name, b]) => {
      const share = b.files / files.length;
      const pct = Math.round(share * 100);
      return [
        "  ",
        name.padEnd(20),
        String(b.files).padStart(5),
        ("+" + num(b.additions)).padStart(11),
        ("-" + num(b.deletions)).padStart(10),
        "   ",
        bar(share),
        " ",
        (pct + "%").padStart(4),
      ].join("");
    });

    const topModules = [...modules.entries()]
      .sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]))
      .slice(0, 8);
    const moduleTable =
      topModules.length === 0
        ? []
        : [
            "",
            "  " +
              "Module".padEnd(20) +
              "Files".padStart(5) +
              "Added".padStart(11) +
              "Removed".padStart(10),
            "  " + "-".repeat(46),
            ...topModules.map(
              ([name, b]) =>
                "  " +
                name.padEnd(20) +
                String(b.files).padStart(5) +
                ("+" + num(b.additions)).padStart(11) +
                ("-" + num(b.deletions)).padStart(10),
            ),
            ...(modules.size > topModules.length
              ? [`  ... and ${modules.size - topModules.length} more modules`]
              : []),
          ];

    const header =
      "  " +
      "Category".padEnd(20) +
      "Files".padStart(5) +
      "Added".padStart(11) +
      "Removed".padStart(10) +
      "   Share";
    const rule = "  " + "-".repeat(66);

    const totals =
      "  " +
      "Total".padEnd(20) +
      String(files.length).padStart(5) +
      ("+" + num(totalAdditions)).padStart(11) +
      ("-" + num(totalDeletions)).padStart(10);

    const fileWord = files.length === 1 ? "file" : "files";
    const title =
      `PR Impact Map · ${num(files.length)} ${fileWord} · ` +
      `+${num(totalAdditions)} / -${num(totalDeletions)} · ${shortSha}`;

    body = [
      MARKER,
      "### PR Impact Map",
      "",
      "```",
      title,
      "-".repeat(title.length),
      "",
      header,
      rule,
      ...table,
      rule,
      totals,
      ...moduleTable,
      "```",
      "",
      `<sub>Updated for \`${shortSha}\` · ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC</sub>`,
    ].join("\n");
  }

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const existing = comments.find(
    (c) => c.user?.login === "github-actions[bot]" && c.body?.includes(MARKER),
  );

  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated impact map comment ${existing.id} on PR #${pr.number}.`);
  } else {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body,
    });
    core.info(`Created impact map comment on PR #${pr.number}.`);
  }
};
