// Package wrapper exec's an underlying AI tool with the right env vars
// pointed at the LangWatch gateway, so the user keeps their familiar
// CLI experience while every request flows through governance.
//
// The wrapper does NOT translate flags or proxy stdin/stdout itself —
// it uses syscall.Exec on Unix to replace the running process with the
// target tool, so terminal handling, signals, and exit codes match what
// the underlying tool would produce when invoked directly.
package wrapper

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

// Tool describes a wrappable AI CLI.
type Tool struct {
	Name     string  // user-visible name: claude, codex, cursor, gemini
	Binary   string  // exec name on PATH; falls back to Name if empty
	EnvVars  []EnvKV // env vars to inject (in addition to inherited environ)
	UpstreamPathPrefix string // gateway path prefix served for this tool
}

// EnvKV is a single env-var assignment.
type EnvKV struct {
	Key   string
	Value string
}

// Run replaces the current process with `tool args...`, with the given
// langwatch credentials wired into the relevant base-URL + auth-token
// env vars for that tool. If the tool isn't in PATH, returns a clear
// error pointing the user at install instructions.
//
// On non-Unix platforms (Windows), syscall.Exec is unavailable; we fall
// back to spawning a subprocess and proxying its exit code.
func Run(cfg *config.Config, t Tool, args []string) error {
	if !cfg.LoggedIn() {
		return errors.New("not logged in — run `langwatch login` first")
	}
	if cfg.DefaultPersonalVK.Secret == "" {
		return errors.New("no personal VK on file — run `langwatch login` to refresh")
	}

	binary := t.Binary
	if binary == "" {
		binary = t.Name
	}

	path, err := exec.LookPath(binary)
	if err != nil {
		return fmt.Errorf("%s not found in PATH — install it first (https://docs.langwatch.ai/ai-gateway/governance/cli-reference#install-tools)", binary)
	}

	env := mergeEnv(os.Environ(), t.EnvVars)

	if runtime.GOOS == "windows" {
		return runSubprocess(path, args, env)
	}
	return runExec(path, args, env)
}

// EnvForTool returns the env vars to inject for a given tool, given a
// loaded config. Centralized so subcommands can call this if they need
// to print the env (e.g. `langwatch init zsh`) without exec'ing.
func EnvForTool(cfg *config.Config, toolName string) []EnvKV {
	gw := cfg.GatewayURL
	auth := cfg.DefaultPersonalVK.Secret
	switch toolName {
	case "claude":
		return []EnvKV{
			{"ANTHROPIC_BASE_URL", gw + "/api/v1/anthropic"},
			{"ANTHROPIC_AUTH_TOKEN", auth},
		}
	case "codex":
		return []EnvKV{
			{"OPENAI_BASE_URL", gw + "/api/v1/openai"},
			{"OPENAI_API_KEY", auth},
		}
	case "cursor":
		return []EnvKV{
			{"OPENAI_BASE_URL", gw + "/api/v1/openai"},
			{"OPENAI_API_KEY", auth},
			{"ANTHROPIC_BASE_URL", gw + "/api/v1/anthropic"},
			{"ANTHROPIC_AUTH_TOKEN", auth},
		}
	case "gemini":
		return []EnvKV{
			{"GOOGLE_GENAI_API_BASE", gw + "/api/v1/gemini"},
			{"GEMINI_API_KEY", auth},
		}
	default:
		return nil
	}
}

func mergeEnv(base []string, kv []EnvKV) []string {
	idx := map[string]int{}
	out := make([]string, len(base))
	copy(out, base)
	for i, e := range out {
		for j := 0; j < len(e); j++ {
			if e[j] == '=' {
				idx[e[:j]] = i
				break
			}
		}
	}
	for _, p := range kv {
		assignment := p.Key + "=" + p.Value
		if i, ok := idx[p.Key]; ok {
			out[i] = assignment
		} else {
			out = append(out, assignment)
		}
	}
	return out
}

func runExec(path string, args []string, env []string) error {
	argv := append([]string{path}, args...)
	if err := syscall.Exec(path, argv, env); err != nil {
		return fmt.Errorf("exec %s: %w", path, err)
	}
	return nil // unreachable
}

func runSubprocess(path string, args []string, env []string) error {
	cmd := exec.Command(path, args...)
	cmd.Env = env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			os.Exit(ee.ExitCode())
		}
		return err
	}
	return nil
}
