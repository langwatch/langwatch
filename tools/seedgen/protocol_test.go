package seedgen

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The fixtures are read by the runner's suite too (SG3), so the two sides cannot drift.
func TestProtocolFixturesRoundTrip(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "protocol", "actions.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		var action Action
		if err := json.Unmarshal(scanner.Bytes(), &action); err != nil {
			t.Fatal(err)
		}
		var written bytes.Buffer
		if err := WriteAction(&written, action); err != nil {
			t.Fatal(err)
		}
		if got := strings.TrimSpace(written.String()); got != scanner.Text() {
			t.Errorf("round trip changed the line:\n%s\n%s", scanner.Text(), got)
		}
	}

	replies, err := os.Open(filepath.Join("testdata", "protocol", "replies.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	defer replies.Close()
	var acks, refusals, retryable int
	err = ReadReplies(replies, func(reply Reply) bool {
		switch {
		case reply.OK:
			acks++
		case reply.Retryable:
			retryable++
		default:
			refusals++
		}
		return true
	})
	if err != nil || acks != 3 || refusals != 1 || retryable != 1 {
		t.Errorf("replies: %d acks, %d refusals, %d retryable, err %v", acks, refusals, retryable, err)
	}
}

func TestReadRepliesRefusesARefusalWithoutACode(t *testing.T) {
	err := ReadReplies(strings.NewReader(`{"id":"r/1","ok":false}`+"\n"), func(Reply) bool { return true })
	if err == nil {
		t.Error("a refusal without a code was accepted")
	}
}

func TestRefsSubstituteKnownRefsAndNameMissingOnes(t *testing.T) {
	refs := Refs{"$org:startup-1": "org_1", "$user:startup-1/owner": "user_1"}
	action := Action{ID: "r/5", Kind: KindProjectCreate, Org: "$org:startup-1", As: "$user:startup-1/owner",
		Input: json.RawMessage(`{"name":"support","price":"$5","team":"$team:startup-1/main"}`)}
	_, err := refs.Substitute(action)
	if err == nil || !strings.Contains(err.Error(), "$team:startup-1/main") {
		t.Fatalf("want the unminted team ref named, got %v", err)
	}
	refs["$team:startup-1/main"] = "team_1"
	got, err := refs.Substitute(action)
	if err != nil {
		t.Fatal(err)
	}
	if got.Org != "org_1" || got.As != "user_1" || string(got.Input) != `{"name":"support","price":"$5","team":"team_1"}` {
		t.Errorf("substituted action: %+v %s", got, got.Input)
	}
}
