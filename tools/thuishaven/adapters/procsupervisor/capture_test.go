package procsupervisor

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// captureSink builds a proc that writes only to a file, so a test can read back
// exactly what capture kept.
func captureSink(t *testing.T) (proc, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "api.log")
	return proc{name: "api", isPlain: true, preview: &recentLogs{}, sink: newLogSink(path)}, path
}

// The api lane prints its errors as one-line JSON, so a stack dump arrives as a
// single line of megabytes. Capture has to keep going after it: the old reader
// stopped at the first over-long line and the lane's log file went quiet for
// days while the process kept serving.
// @scenario "One unreadable line never ends the capture"
func TestStreamSurvivesALineLongerThanTheReadBuffer(t *testing.T) {
	c, path := captureSink(t)
	huge := strings.Repeat("x", 3*streamMaxLine)

	c.stream(strings.NewReader("before\n" + huge + "\nafter\n"))

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	captured := string(b)
	if !strings.Contains(captured, "before") {
		t.Error("the line before the over-long one was dropped")
	}
	if !strings.Contains(captured, "after") {
		t.Fatal("capture stopped at the over-long line: everything after it is lost")
	}
	if got := strings.Count(captured, "x"); got != len(huge) {
		t.Errorf("kept %d bytes of the long line, want all %d (split across lines is fine)", got, len(huge))
	}
}

// errAfter reads n bytes and then fails the way a broken pipe does.
type errAfter struct {
	r    io.Reader
	err  error
	done bool
}

func (e *errAfter) Read(p []byte) (int, error) {
	if e.done {
		return 0, e.err
	}
	n, err := e.r.Read(p)
	if errors.Is(err, io.EOF) {
		e.done = true
		return n, e.err
	}
	return n, err
}

// A read error is not EOF: the old reader swallowed it silently, so an operator
// grepping the log saw a lane that simply stopped talking.
// @scenario "A read error is recorded, not swallowed"
func TestStreamRecordsAReadErrorAndKeepsWhatItHad(t *testing.T) {
	c, path := captureSink(t)

	c.stream(&errAfter{r: strings.NewReader("one\ntwo\n"), err: errors.New("input/output error")})

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	captured := string(b)
	for _, want := range []string{"one", "two", "log capture read error: input/output error"} {
		if !strings.Contains(captured, want) {
			t.Errorf("capture = %q, want it to contain %q", captured, want)
		}
	}
}

// A trailing fragment with no newline is what a crashing process leaves behind.
// It is the most interesting line in the file, so it must be captured.
func TestStreamCapturesTheLastLineWithoutANewline(t *testing.T) {
	c, path := captureSink(t)

	c.stream(strings.NewReader("finished\nsegmentation fault"))

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "segmentation fault") {
		t.Errorf("capture = %q, want the unterminated last line", string(b))
	}
}

// The whole point of draining: a child that writes more than the pipe buffer
// holds blocks on write until somebody reads. One over-long line used to stop
// the reader, and the process then wedged with no log line explaining why.
// @scenario "One unreadable line never ends the capture"
func TestAChildThatPrintsAHugeLineIsNotBlocked(t *testing.T) {
	c, path := captureSink(t)
	// One line far larger than both the pipe buffer and streamMaxLine, then a
	// marker: the marker only prints if the child got past that write.
	c.dir, c.shell = ".", `head -c 2000000 /dev/zero | tr '\0' 'y'; echo; echo CHILD-FINISHED`

	cmd := c.command(t.Context())
	waitStreams := c.pipe(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		waitStreams()
		done <- cmd.Wait()
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("child should exit cleanly: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the child never finished: the reader stopped draining its pipe")
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "CHILD-FINISHED") {
		t.Error("the child blocked on its own output instead of running to the end")
	}
	// At least: the login shell may add its own stderr chatter, which is
	// captured too.
	if got := strings.Count(string(b), "y"); got < 2000000 {
		t.Errorf("captured %d bytes of the huge line, want all 2000000", got)
	}
}
