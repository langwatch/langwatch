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
	walks, _, _, findings, err := BrowserFindings(path, -1, -1, false)
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
		`{"kind":"requestfailed","url":"https://static.reo.dev/reo.js","text":"net::ERR_FAILED"}` + "\n" +
		`{"kind":"requestfailed","url":"http://x/api/trpc/traces.spanTreePaginated?input=%7B%7D","text":"net::ERR_ABORTED"}` + "\n" +
		`{"kind":"requestfailed","url":"http://x/api/trpc/traces.spanTreePaginated?input=%7B%7D","text":"net::ERR_FAILED"}` + "\n"
	_ = os.WriteFile(path, []byte(lines), 0o600)
	_, _, tolerated, findings, err := BrowserFindings(path, -1, -1, false)
	if err != nil || len(findings) != 2 || findings[0].Text != "net::ERR_FAILED" || len(tolerated) != 3 {
		t.Errorf("findings %+v tolerated %v err %v", findings, tolerated, err)
	}
}

// @scenario "Main's tab reconnecting its tRPC WebSocket just after the switch is tolerated"
func TestMainTabAcrossSwitchIsWindowedAfterTheSwitch(t *testing.T) {
	ws := BrowserRecord{Kind: "console", AtMs: 1_010, Text: "WebSocket connection to 'ws://x/api/trpc-ws' failed: Unexpected response code: 404"}
	if !mainTabAcrossSwitch(ws, 1_000) {
		t.Error("reconnect just after the switch not tolerated")
	}
	for name, mutate := range map[string]func(BrowserRecord) BrowserRecord{
		"before the switch": func(r BrowserRecord) BrowserRecord { r.AtMs = 900; return r },
		"a minute after":    func(r BrowserRecord) BrowserRecord { r.AtMs = 61_001; return r },
		"another socket": func(r BrowserRecord) BrowserRecord {
			r.Text = "WebSocket connection to 'ws://x/api/other' failed"
			return r
		},
		"a failed http request": func(r BrowserRecord) BrowserRecord { r.Kind = "http"; return r },
	} {
		if mainTabAcrossSwitch(mutate(ws), 1_000) {
			t.Errorf("%s tolerated", name)
		}
	}
	if mainTabAcrossSwitch(ws, -1) {
		t.Error("tolerated before the switch is known")
	}
}

// @scenario "Main's page loading its assets from head just after the switch is tolerated"
func TestMainPageAcrossSwitchIsWindowedAssetNotFound(t *testing.T) {
	cases := []BrowserRecord{
		{Kind: "http", AtMs: 1_010, URL: "http://x/assets/index-Bty315CS.js", Status: 404},
		{Kind: "requestfailed", AtMs: 1_010, URL: "http://x/assets/index-Bty315CS.js", Text: "net::ERR_ABORTED"},
		{Kind: "console", AtMs: 1_010, URL: "http://x/", Text: "Failed to load resource: the server responded with a status of 404 (Not Found)"},
		{Kind: "console", AtMs: 1_010, URL: "http://x/settings", Text: "Refused to apply style from 'http://x/assets/zod-uBOWI0as.css' because its MIME type ('text/plain') is not a supported stylesheet MIME type, and strict MIME checking is enabled."},
	}
	for _, record := range cases {
		if !mainPageAcrossSwitch(record, 1_000) {
			t.Errorf("%s just after the switch not tolerated", record.Kind)
		}
		if mainPageAcrossSwitch(record, -1) {
			t.Errorf("%s tolerated before the switch is known", record.Kind)
		}
	}
	for name, record := range map[string]BrowserRecord{
		"before the switch": {Kind: "http", AtMs: 900, URL: "http://x/assets/a.js", Status: 404},
		"a minute after":    {Kind: "http", AtMs: 61_001, URL: "http://x/assets/a.js", Status: 404},
		"outside /assets/":  {Kind: "http", AtMs: 1_010, URL: "http://x/api/dataset", Status: 404},
		"another status":    {Kind: "http", AtMs: 1_010, URL: "http://x/assets/a.js", Status: 500},
		"another console":   {Kind: "console", AtMs: 1_010, Text: "status of 500 (Internal Server Error)"},
	} {
		if mainPageAcrossSwitch(record, 1_000) {
			t.Errorf("%s tolerated", name)
		}
	}
}

func TestMainClientOutdatedIsWindowedEnvelopeRefusal(t *testing.T) {
	enveloped := "http://x/api/trpc/featureFlag.isEnabled?input=%7B%22json%22%3A%7B%22flag%22%3A%22f%22%7D%7D"
	for _, record := range []BrowserRecord{
		{Kind: "http", AtMs: 1_010, URL: enveloped, Status: 400},
		{Kind: "http", AtMs: 1_010, URL: "http://x/api/trpc-ws", Status: 404},
		{Kind: "console", AtMs: 1_010, URL: "http://x/settings", Text: "Failed to load resource: the server responded with a status of 400 (Bad Request)"},
	} {
		if !mainClientOutdated(record, 1_000) {
			t.Errorf("%s %s just after the switch not tolerated", record.Kind, record.URL)
		}
		if mainClientOutdated(record, -1) {
			t.Errorf("%s tolerated before the switch is known", record.Kind)
		}
	}
	for name, record := range map[string]BrowserRecord{
		"head's own plain input": {Kind: "http", AtMs: 1_010, URL: "http://x/api/trpc/featureFlag.isEnabled?input=%7B%22flag%22%3A%22f%22%7D", Status: 400},
		"a minute after":         {Kind: "http", AtMs: 61_001, URL: enveloped, Status: 400},
		"before the switch":      {Kind: "http", AtMs: 900, URL: enveloped, Status: 400},
		"another status":         {Kind: "http", AtMs: 1_010, URL: enveloped, Status: 500},
	} {
		if mainClientOutdated(record, 1_000) {
			t.Errorf("%s tolerated", name)
		}
	}
}

// @scenario "A stop-start install's downtime 502s are tolerated, a rolling deploy's are findings"
func TestStopStartDowntimeIsToleratedOnlyWhileDown(t *testing.T) {
	path := filepath.Join(t.TempDir(), "browser.jsonl")
	lines := `{"phase":"down","kind":"http","url":"http://x/ops/upgrades","status":502}` + "\n" +
		`{"phase":"down","kind":"requestfailed","url":"http://x/assets/a.js","text":"net::ERR_ABORTED"}` + "\n" +
		`{"phase":"ready","kind":"http","url":"http://x/ops/upgrades","status":502}` + "\n"
	_ = os.WriteFile(path, []byte(lines), 0o600)
	_, _, tolerated, findings, err := BrowserFindings(path, -1, -1, true)
	if err != nil || len(findings) != 1 || findings[0].Phase != "ready" || len(tolerated) != 1 {
		t.Errorf("stop-start: findings %+v tolerated %v err %v", findings, tolerated, err)
	}
	if _, _, _, findings, _ := BrowserFindings(path, -1, -1, false); len(findings) != 3 {
		t.Errorf("rolling: %d findings, want 3", len(findings))
	}
}

// @scenario "The console echo of an expected upgrade_in_progress 503 is counted apart, one per 503"
func TestConsoleTwinOfAnExpected503IsCappedByThe503s(t *testing.T) {
	path := filepath.Join(t.TempDir(), "browser.jsonl")
	expected503 := `{"atMs":50,"kind":"http","status":503,"retryAfter":"10","text":"{\"error\":{\"message\":\"upgrade_in_progress\"}}"}`
	echo := `{"atMs":51,"kind":"console","text":"Failed to load resource: the server responded with a status of 503 (Service Unavailable)"}`
	_ = os.WriteFile(path, []byte(expected503+"\n"+echo+"\n"+echo+"\n"), 0o600)
	_, expected, tolerated, findings, err := BrowserFindings(path, 10, 100, false)
	if err != nil || expected != 1 || len(tolerated) != 1 || len(findings) != 1 {
		t.Errorf("expected %d tolerated %v findings %+v err %v", expected, tolerated, findings, err)
	}
}

func TestAnUnreadUpgrade503CountsOnlyWhereTheSamePathAnsweredUpgradeInProgress(t *testing.T) {
	path := filepath.Join(t.TempDir(), "browser.jsonl")
	unread := `{"atMs":40,"kind":"http","url":"http://x/api/trpc/user.updateLastLogin","status":503,"retryAfter":"10","text":"body unread: No resource with given identifier"}`
	readable := `{"atMs":45,"kind":"http","url":"http://x/api/trpc/user.updateLastLogin","status":503,"retryAfter":"10","text":"{\"error\":{\"message\":\"upgrade_in_progress\"}}"}`
	other := `{"atMs":46,"kind":"http","url":"http://x/api/trpc/other","status":503,"retryAfter":"5","text":"body unread: gone"}`
	echo := `{"atMs":60,"kind":"console","text":"Failed to load resource: the server responded with a status of 503 (Service Unavailable)"}`
	_ = os.WriteFile(path, []byte(unread+"\n"+readable+"\n"+other+"\n"+echo+"\n"+echo+"\n"), 0o600)
	_, expected, _, findings, err := BrowserFindings(path, 10, 100, false)
	if err != nil || expected != 2 || len(findings) != 1 || findings[0].URL != "http://x/api/trpc/other" {
		t.Errorf("expected %d findings %+v err %v", expected, findings, err)
	}
}

func TestReopenedLeavesTheRetryDrillsOwnStepToD3(t *testing.T) {
	atReady := []LedgerRow{{ID: "a:drilled", Status: "done", Attempt: 1}, {ID: "b:other", Status: "done", Attempt: 1}}
	final := []LedgerRow{{ID: "a:drilled", Status: "done", Attempt: 2}, {ID: "b:other", Status: "done", Attempt: 1}}
	if got := reopenedVerdict(atReady, final, "a:drilled"); got.Result != "pass" {
		t.Errorf("drilled step counted: %+v", got)
	}
	if got := reopenedVerdict(atReady, final, ""); got.Result == "pass" {
		t.Errorf("reopened step missed without a drill: %+v", got)
	}
}
