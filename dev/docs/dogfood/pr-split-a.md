# What is a git worktree

A git worktree is a second working directory linked to the same git repository. It lets you check out a different branch in a separate folder, without cloning the repository again or switching branches in your main folder. Each worktree has its own files on disk, but they all share the same commit history and object store. This makes it easy to work on more than one branch at the same time, for example to run tests on one branch while you keep coding on another.

You can remove a worktree with `git worktree remove <path>` once you no longer need it.
