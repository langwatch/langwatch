package codeblock_test

// The docs pages publish some of these examples as complete, copy-pasteable
// files. A reader who copies a fence gets code that was never executed unless
// the fence and the committed file are the same bytes, so this test pins them
// together. The committed file is the source: it is what the example tests run.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// repoRoot is this package's path back to the top of the repository.
const repoRoot = "../../../../../.."

// publishedExamples maps a docs page to the example whose full text it carries.
// The fence is found by its info string, `python <file name>`.
var publishedExamples = map[string]string{
	"docs/agent-simulations/authenticated-agents.mdx": "shared_session_code_agent.py",
}

func TestExamplesPublishedInTheDocsMatchTheCommittedFile(t *testing.T) {
	for page, exampleName := range publishedExamples {
		t.Run(exampleName, func(t *testing.T) {
			committed, err := os.ReadFile(filepath.Join("examples", exampleName))
			require.NoError(t, err)

			doc, err := os.ReadFile(filepath.Join(repoRoot, page))
			require.NoError(t, err)

			published, isFound := fencedBlock(string(doc), "python "+exampleName)
			require.True(t, isFound,
				"%s carries no ```python %s fence; the docs must publish the whole example",
				page, exampleName)

			require.Equal(t, string(committed), published,
				"%s has drifted from examples/%s. Copy the file into the fence.",
				page, exampleName)
		})
	}
}

// fencedBlock returns the contents of the first fenced block whose info string
// is exactly info, and whether such a block was found.
func fencedBlock(document, info string) (string, bool) {
	open := "```" + info + "\n"
	start := strings.Index(document, open)
	if start < 0 {
		return "", false
	}
	body := document[start+len(open):]
	end := strings.Index(body, "```")
	if end < 0 {
		return "", false
	}
	return body[:end], true
}
