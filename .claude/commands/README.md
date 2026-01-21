# Commands

Slash commands (`/command`) that invoke agents or perform tasks.

## Available Commands

- `/onboard` - Orientation + code review
- `/review` - Clean Code review
- `/sherpa` - Repository guide
- `/pr-review` - Address PR comments from Code Rabbit/reviewers
- `/worktree` - Create git worktree with proper setup

## Writing Commands

Commands should be 1-5 lines. If a command invokes an agent, the agent has its own instructions - don't repeat them.
