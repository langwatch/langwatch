// Package claudecode runs the Claude Code CLI (`claude -p --output-format
// stream-json --verbose`) as the agent under test of a scenario.
//
// Each turn flattens the conversation into one prompt, runs the CLI in a
// working directory, decodes its stream-json output as it arrives, and
// returns the turn as the assistant-visible text (OutputText, the default)
// or as messages carrying the tool calls and tool results (OutputMessages),
// which the judge and LangWatch read structurally.
//
//	agent, err := claudecode.New(claudecode.Config{
//		WorkingDirectory: dir,
//		Model:            "claude-sonnet-4-5",
//		SkillPath:        "skills/my-skill/SKILL.md", // copied into dir
//		Output:           claudecode.OutputMessages,
//		SkipPermissions:  true, // only in sandboxed or CI environments
//		UnsetEnv:         []string{"OPENAI_API_KEY"}, // the judge's key, not the agent's
//	})
//	if err != nil {
//		t.Fatal(err)
//	}
//	result, err := scenario.Run(ctx, scenario.ScenarioConfig{
//		Name:        "my skill",
//		Description: "The user asks the agent to use my-skill.",
//		Agents:      []scenario.AgentAdapter{agent, userSim, judge},
//		Script:      []scenario.ScriptStep{scenario.User("Do something"), scenario.Agent(), scenario.Judge()},
//	})
//	var cliErr *claudecode.CLIError
//	if errors.As(err, &cliErr) {
//		t.Fatalf("claude exited %d: %s", cliErr.ExitCode, cliErr.Stderr)
//	}
//	if err := claudecode.AssertSkillWasRead(result.Messages, "my-skill"); err != nil {
//		t.Error(err)
//	}
//	t.Log(claudecode.BashCommands(result.Messages))
//
// Sessions: `claude -p` is one-shot, but the CLI keeps server-side session
// state keyed by a session id. The adapter keeps one session per thread. A
// thread's first turn sends the full history and captures the session id;
// later turns pass --resume <id> and send only the new messages. When a
// resumed session has vanished server-side the turn fails with a
// *LostSessionError, or, with Config.ReplayOnLostSession, is rebuilt from
// the full history in a fresh session (losing server-side state such as the
// context cache).
//
// Process lifecycle: the CLI leads its own process group, a watchdog kills
// that group if the test process dies first, and a timeout or a cancelled
// context terminates the whole group (SIGTERM, then SIGKILL).
package claudecode
