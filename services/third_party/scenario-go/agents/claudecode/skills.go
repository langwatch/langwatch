package claudecode

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	scenario "github.com/langwatch/scenario/go"
)

// InjectSkill copies a SKILL.md into <workingDirectory>/.skills/<name>/SKILL.md,
// where <name> is the SKILL.md's parent directory name, then points the
// working directory's CLAUDE.md at every installed skill (see
// PointClaudeMdAtSkills). It overwrites an existing copy of the same skill,
// so it is meant for a test or scratch working directory.
func InjectSkill(workingDirectory, skillPath string) error {
	name := filepath.Base(filepath.Dir(skillPath))
	dir := filepath.Join(workingDirectory, ".skills", name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("inject skill: %w", err)
	}
	data, err := os.ReadFile(skillPath)
	if err != nil {
		return fmt.Errorf("inject skill: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), data, 0o644); err != nil {
		return fmt.Errorf("inject skill: %w", err)
	}
	return PointClaudeMdAtSkills(workingDirectory)
}

// PointClaudeMdAtSkills makes the working directory's CLAUDE.md tell Claude
// Code to read every .skills/<name>/SKILL.md before doing anything else.
// Claude Code does not discover .skills/ in an arbitrary directory on its
// own. An existing CLAUDE.md (often part of what the agent is tested against)
// is kept and only the skills it does not mention yet are appended, so a
// second call changes nothing. A directory without skills is left alone.
func PointClaudeMdAtSkills(workingDirectory string) error {
	entries, err := os.ReadDir(filepath.Join(workingDirectory, ".skills"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("point CLAUDE.md at skills: %w", err)
	}
	var skills []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(workingDirectory, ".skills", e.Name(), "SKILL.md")); err == nil {
			skills = append(skills, ".skills/"+e.Name()+"/SKILL.md")
		}
	}
	if len(skills) == 0 {
		return nil
	}

	claudeMd := filepath.Join(workingDirectory, "CLAUDE.md")
	existing, err := os.ReadFile(claudeMd)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("point CLAUDE.md at skills: %w", err)
	}
	var missing []string
	for _, s := range skills {
		if !strings.Contains(string(existing), s) {
			missing = append(missing, s)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	separator := ""
	if len(existing) > 0 && existing[len(existing)-1] != '\n' {
		separator = "\n"
	}
	f, err := os.OpenFile(claudeMd, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("point CLAUDE.md at skills: %w", err)
	}
	_, err = f.WriteString(separator + "Read and follow the instructions in " + strings.Join(missing, " and ") + " before doing anything else.\n")
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("point CLAUDE.md at skills: %w", err)
	}
	return nil
}

// AssertSkillWasRead returns an error naming the skill unless the
// conversation references its .skills/<name>/SKILL.md (or
// skills/<name>/SKILL.md) path in some message's text, parts or tool call
// arguments: evidence the agent read the skill rather than hallucinating
// instructions.
func AssertSkillWasRead(messages []scenario.Message, skillName string) error {
	// ".skills/<name>/SKILL.md" contains "skills/<name>/SKILL.md", so one
	// needle covers both paths.
	needle := "skills/" + skillName + "/SKILL.md"
	for i := range messages {
		if mentions(&messages[i], needle) {
			return nil
		}
	}
	return fmt.Errorf("expected agent to read the %s SKILL.md file, but found no evidence of reading "+
		".skills/%s/SKILL.md in the conversation; the agent may have ignored the skill and hallucinated instructions",
		skillName, skillName)
}

func mentions(m *scenario.Message, needle string) bool {
	if strings.Contains(m.Content, needle) {
		return true
	}
	for _, p := range m.Parts {
		if strings.Contains(p.Text, needle) || strings.Contains(string(p.Raw), needle) {
			return true
		}
	}
	for _, tc := range m.ToolCalls {
		if strings.Contains(tc.Arguments, needle) {
			return true
		}
	}
	return false
}

// BashCommands lists the shell commands the agent ran: the command argument
// of every Bash tool call. A command quoted in text (the skill the agent read,
// its own account of what it did not do) is not a command that ran, so only
// tool calls count, which is what OutputMessages produces.
func BashCommands(messages []scenario.Message) []string {
	var commands []string
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			if tc.Name != "Bash" {
				continue
			}
			var input struct {
				Command any `json:"command"`
			}
			_ = json.Unmarshal([]byte(tc.Arguments), &input)
			if command, ok := input.Command.(string); ok {
				commands = append(commands, command)
			}
		}
	}
	return commands
}
