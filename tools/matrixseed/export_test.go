package matrixseed

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

/** @scenario "Every exported secret is masked before it is written" */
func TestWriteExportsMasksEveryValueBeforeWritingIt(t *testing.T) {
	var log, env bytes.Buffer
	exports := []Export{{"LW_PROJECT_API_KEY", "sk-lw-project"}, {"TEST_VK_OPENAI", "lw_vk_openai"}}
	if err := WriteExports(&log, &env, exports); err != nil {
		t.Fatal(err)
	}
	if got, want := log.String(), "::add-mask::sk-lw-project\n::add-mask::lw_vk_openai\n"; got != want {
		t.Fatalf("log = %q, want %q", got, want)
	}
	if got, want := env.String(), "LW_PROJECT_API_KEY=sk-lw-project\nTEST_VK_OPENAI=lw_vk_openai\n"; got != want {
		t.Fatalf("env file = %q, want %q", got, want)
	}

	var report bytes.Buffer
	Report(&report, Result{
		Exports:  exports,
		Skipped:  []Skipped{{Provider: Providers[1], Missing: []string{"ANTHROPIC_API_KEY"}}},
		Failures: []Failure{{Provider: Providers[2], Err: errors.New("answered 500")}},
	})
	for _, value := range []string{"sk-lw-project", "lw_vk_openai"} {
		if strings.Contains(report.String(), value) {
			t.Fatalf("the report printed a value: %q", report.String())
		}
	}
	for _, want := range []string{"seeded   TEST_VK_OPENAI", "skipped  TEST_VK_ANTHROPIC: no ANTHROPIC_API_KEY", "::error::the control plane refused to seed gemini"} {
		if !strings.Contains(report.String(), want) {
			t.Errorf("report lacks %q:\n%s", want, report.String())
		}
	}
}

func TestWriteExportsRefusesAMultiLineValueBeforeWritingAnything(t *testing.T) {
	var log, env bytes.Buffer
	err := WriteExports(&log, &env, []Export{{"TEST_VK_OPENAI", "lw_vk"}, {"TEST_VK_VERTEX", "line\nbreak"}})
	if err == nil || env.Len() != 0 || log.Len() != 0 {
		t.Fatalf("want a refusal and nothing masked or written, got err=%v log=%q env=%q", err, log.String(), env.String())
	}
}
