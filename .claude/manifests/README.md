# .claude/manifests/

Runtime state. One file per task, `<task-id>.md`, written by the coordinator
**before** the lane starts.

Everything in here except this README is gitignored. A manifest is the contract
for one task in one drive; it is not documentation and it does not survive the
drive.

## The shape

Template: `.claude/coordinator/manifest-template.md`.

The three sections that decide whether the lane succeeds:

- **Owned paths** - explicit, never a regex and never "all dirty files minus X".
  A lane resolves this list literally, and a slice built from a pattern once
  swept 1,730 files belonging to another lane.
- **Read-only reference paths** - naming the exemplar. A lane with no exemplar
  greps for one, and that is most of a wasted lane.
- **Completion criteria** - checkable claims. If the coordinator cannot check
  it, the lane cannot know it is done.

A manifest also carries a `Model:` line. It is advisory until the coordinator
actually passes that model when spawning the lane, so the coordinator enforces
it - see `.claude/coordinator/COORDINATOR.md`, section 3.

If a task's owned paths cannot be named, it is not ready to be a task. Split it.
