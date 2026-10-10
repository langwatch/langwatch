package cell

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSumGroupsAddsEachWantedGroup(t *testing.T) {
	out := " 10 1000 1.5\n 10 500 0.5\n 11 99 9\n 12 7 1\n"
	got := sumGroups(out, map[int]string{10: "head-api", 12: "head-worker"}, 5)
	if len(got) != 2 || got[0].Name != "head-api" || got[0].RSSKB != 1500 || got[0].CPU != 2 || got[1].RSSKB != 7 {
		t.Errorf("sumGroups = %+v", got)
	}
}

func TestRedisUsedMemory(t *testing.T) {
	if bytes, ok := redisUsedMemory("# Memory\r\nused_memory:2048\r\nused_memory_human:2K\r\n"); !ok || bytes != 2048 {
		t.Errorf("redisUsedMemory = %d, %v", bytes, ok)
	}
}

func TestResourcePeaksKeepsTheHighest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resources.jsonl")
	_ = os.WriteFile(path, []byte(`{"atMs":1,"name":"a","rssKb":10,"cpuPct":5}`+"\n"+`{"atMs":2,"name":"a","rssKb":30,"cpuPct":1}`+"\n"+`{"atMs":2,"name":"redis","bytes":9}`+"\n"), 0o600)
	peaks, err := ResourcePeaks(path)
	if err != nil || len(peaks) != 2 || peaks[0].RSSKB != 30 || peaks[0].CPU != 5 || peaks[1].Bytes != 9 {
		t.Errorf("peaks = %+v, %v", peaks, err)
	}
}

func TestBrowserFindingsCountsWalksAndHonoursTheAcceptedList(t *testing.T) {
	path := filepath.Join(t.TempDir(), "browser.jsonl")
	_ = os.WriteFile(path, []byte(`{"kind":"walk"}`+"\n"+`{"kind":"console","text":"boom"}`+"\n"+`{"kind":"http","url":"http://x/ok-noise","status":503}`+"\n"+`{"kind":"walkerror"}`+"\n"), 0o600)
	saved := acceptedBrowserNoise
	acceptedBrowserNoise = []browserNoise{{[]string{"ok-noise"}, "test"}}
	defer func() { acceptedBrowserNoise = saved }()
	walks, _, _, findings, err := BrowserFindings(path, -1, -1)
	if err != nil || walks != 1 || len(findings) != 1 || findings[0].Text != "boom" {
		t.Errorf("walks %d findings %+v err %v", walks, findings, err)
	}
}

// @scenario "Only listed log signatures are accepted, the upgrade error only between the switch and ready"
func TestAcceptsOnlyListedSignaturesAndWindowsTheUpgradeError(t *testing.T) {
	origin := time.UnixMilli(1_000_000_000_000)
	if _, ok := accepts(`ERROR TwilioTunnel: cloudflared exited`, -1, -1, origin); !ok {
		t.Error("cloudflared line not accepted")
	}
	in := `{"level":"error","time":1000000005000,"err":"UpgradeInProgressError"}`
	if _, ok := accepts(in, 1000, 9000, origin); !ok {
		t.Error("in-window upgrade error not accepted")
	}
	if _, ok := accepts(in, 6000, 9000, origin); ok {
		t.Error("out-of-window upgrade error accepted")
	}
	if _, ok := accepts(`ERROR Error checking trace limit`, 0, 9000, origin); ok {
		t.Error("trace limit error accepted")
	}
}

// @scenario "Only an upgrade_in_progress 503 with Retry-After between the switch and ready is expected noise"
func TestExpectedWhileStepsRunNeedsCodeRetryAfterAndWindow(t *testing.T) {
	ok := BrowserRecord{Kind: "http", Status: 503, RetryAfter: "5", Text: `{"code":"upgrade_in_progress"}`, AtMs: 50}
	if !expectedWhileStepsRun(ok, 10, 100) {
		t.Error("in-window 503 upgrade_in_progress with Retry-After not accepted")
	}
	for name, mutate := range map[string]func(BrowserRecord) BrowserRecord{
		"no retry-after": func(r BrowserRecord) BrowserRecord { r.RetryAfter = ""; return r },
		"other status":   func(r BrowserRecord) BrowserRecord { r.Status = 500; return r },
		"other code":     func(r BrowserRecord) BrowserRecord { r.Text = "boom"; return r },
		"outside window": func(r BrowserRecord) BrowserRecord { r.AtMs = 200; return r },
		"console":        func(r BrowserRecord) BrowserRecord { r.Kind = "console"; return r },
	} {
		if expectedWhileStepsRun(mutate(ok), 10, 100) {
			t.Errorf("%s accepted", name)
		}
	}
	if expectedWhileStepsRun(ok, 10, -1) {
		t.Error("accepted before ready is known")
	}
}

func TestBrowserFindingsCountsThirdPartyNoiseApart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "browser.jsonl")
	lines := `{"kind":"console","text":"Loading the script 'https://static.hotjar.com/c.js' violates the following Content Security Policy"}` + "\n" +
		`{"kind":"requestfailed","url":"https://static.reo.dev/reo.js","text":"net::ERR_BLOCKED_BY_ORB"}` + "\n" +
		`{"kind":"requestfailed","url":"https://static.reo.dev/reo.js","text":"net::ERR_FAILED"}` + "\n"
	_ = os.WriteFile(path, []byte(lines), 0o600)
	_, _, tolerated, findings, err := BrowserFindings(path, -1, -1)
	if err != nil || len(findings) != 1 || findings[0].Text != "net::ERR_FAILED" || len(tolerated) != 2 {
		t.Errorf("findings %+v tolerated %v err %v", findings, tolerated, err)
	}
}
