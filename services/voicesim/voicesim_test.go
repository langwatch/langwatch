package voicesim

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s := newServer(Config{Stack: "feat-x"}, fstest.MapFS{"index.html": {Data: []byte("<div id=root></div>")}})
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return s, srv
}

func do(t *testing.T, method, url, contentType string, body io.Reader) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func getJSON(t *testing.T, url string, into any) int {
	t.Helper()
	resp := do(t, http.MethodGet, url, "", nil)
	if into != nil {
		if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode
}

// testClient is the client end of the conversation socket: masked frames out, as RFC 6455 requires.
type testClient struct {
	conn net.Conn
	r    *bufio.Reader
}

func dial(t *testing.T, srv *httptest.Server, agentID string) *testClient {
	t.Helper()
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	_, _ = io.WriteString(conn, "GET /v1/convai/conversation?agent_id="+agentID+" HTTP/1.1\r\nHost: voicesim\r\n"+
		"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
	r := bufio.NewReader(conn)
	resp, err := http.ReadResponse(r, nil)
	if err != nil {
		t.Fatal(err)
	}
	// The RFC 6455 worked example's accept key for that nonce.
	if resp.StatusCode != http.StatusSwitchingProtocols || resp.Header.Get("Sec-WebSocket-Accept") != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" {
		t.Fatalf("handshake = %d accept %q", resp.StatusCode, resp.Header.Get("Sec-WebSocket-Accept"))
	}
	return &testClient{conn: conn, r: r}
}

func (c *testClient) send(t *testing.T, v any) {
	t.Helper()
	payload, _ := json.Marshal(v)
	frame := []byte{0x81}
	if len(payload) < 126 {
		frame = append(frame, 0x80|byte(len(payload)))
	} else {
		frame = binary.BigEndian.AppendUint16(append(frame, 0x80|126), uint16(len(payload)))
	}
	mask := []byte{1, 2, 3, 4}
	frame = append(frame, mask...)
	for i, b := range payload {
		frame = append(frame, b^mask[i%4])
	}
	if _, err := c.conn.Write(frame); err != nil {
		t.Fatal(err)
	}
}

func (c *testClient) next(t *testing.T) map[string]any {
	t.Helper()
	ws := &wsConn{conn: c.conn, r: c.r}
	raw, err := ws.readMessage()
	if err != nil {
		t.Fatal(err)
	}
	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatal(err)
	}
	return msg
}

// speak sends one caller turn the way the SDK's pump does: speech, then 20 ms silent frames.
func (c *testClient) speak(t *testing.T) {
	t.Helper()
	c.send(t, map[string]string{"user_audio_chunk": base64.StdEncoding.EncodeToString(tone("hello there", callerToneHz))})
	silence := base64.StdEncoding.EncodeToString(make([]byte, 960))
	for range 20 {
		c.send(t, map[string]string{"user_audio_chunk": silence})
	}
}

// expectTurn reads one scripted reply and returns its agent line and audio event count.
func (c *testClient) expectTurn(t *testing.T) (string, int) {
	t.Helper()
	if msg := c.next(t); msg["type"] != "user_transcript" {
		t.Fatalf("first reply event = %v, want user_transcript", msg)
	}
	msg := c.next(t)
	event, _ := msg["agent_response_event"].(map[string]any)
	line, _ := event["agent_response"].(string)
	want := (len(tone(line, agentToneHz)) + agentFrameBytes - 1) / agentFrameBytes
	for range want {
		audio := c.next(t)
		ev, _ := audio["audio_event"].(map[string]any)
		encoded, _ := ev["audio_base_64"].(string)
		pcm, _ := base64.StdEncoding.DecodeString(encoded)
		if audio["type"] != "audio" || !isLoud(pcm) {
			t.Fatalf("expected a loud audio event, got %v", audio["type"])
		}
	}
	return line, want
}

// @scenario "A scenario's ElevenLabs agent answers each caller turn"
func TestConversationAnswersEachCallerTurnFromTheScript(t *testing.T) {
	s, srv := newTestServer(t)
	var signed map[string]string
	getJSON(t, srv.URL+"/v1/convai/conversation/get-signed-url?agent_id=agent_1", &signed)
	if !strings.HasPrefix(signed["signed_url"], "ws://"+srv.Listener.Addr().String()+"/v1/convai/conversation?agent_id=agent_1") {
		t.Fatalf("signed_url = %q, want this server's conversation socket", signed["signed_url"])
	}

	client := dial(t, srv, "agent_1")
	client.send(t, map[string]string{"type": "conversation_initiation_client_data"})
	meta := client.next(t)
	event, _ := meta["conversation_initiation_metadata_event"].(map[string]any)
	if meta["type"] != "conversation_initiation_metadata" || event["conversation_id"] != "conv_voicesim_0001" ||
		event["agent_output_audio_format"] != "pcm_24000" {
		t.Fatalf("metadata = %v", meta)
	}
	for turn := range 2 {
		client.speak(t)
		if line, _ := client.expectTurn(t); line != AgentLines[turn] {
			t.Fatalf("turn %d answered %q, want %q", turn, line, AgentLines[turn])
		}
	}

	if got := s.calls.len(); got != 1 {
		t.Fatalf("the console holds %d calls, want 1", got)
	}
}

// @scenario "Silence alone never starts a turn"
func TestTurnDetectorWaitsForSpeechThenSilence(t *testing.T) {
	var d turnDetector
	silence := make([]byte, 960)
	for range 50 {
		if d.feed(silence) {
			t.Fatal("silence with no speech ended a turn")
		}
	}
	d.feed(tone("hi", callerToneHz))
	ended := 0
	for range 50 {
		if d.feed(silence) {
			ended++
		}
	}
	if ended != 1 {
		t.Fatalf("speech then silence ended %d turns, want exactly 1", ended)
	}
}

// @scenario "The caller's speech and transcription are canned"
func TestSpeechIsADeterministicToneAndTranscriptionIsCanned(t *testing.T) {
	_, srv := newTestServer(t)
	speak := func(input, format string) (*http.Response, []byte) {
		body, _ := json.Marshal(map[string]string{"model": "gpt-4o-mini-tts", "voice": "alloy", "input": input, "response_format": format})
		resp := do(t, http.MethodPost, srv.URL+"/v1/audio/speech", "application/json", bytes.NewReader(body))
		pcm, _ := io.ReadAll(resp.Body)
		return resp, pcm
	}
	resp, short := speak("hello", "pcm")
	_, again := speak("hello", "pcm")
	_, long := speak("a much longer sentence for the agent to hear", "pcm")
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "audio/pcm" || !isLoud(short) ||
		!bytes.Equal(short, again) || len(long) <= len(short) || len(short)%2 != 0 {
		t.Fatalf("speech = %d %q, %d bytes (again %d, long %d)", resp.StatusCode, resp.Header.Get("Content-Type"), len(short), len(again), len(long))
	}
	if refused, _ := speak("hello", "mp3"); refused.StatusCode != http.StatusBadRequest {
		t.Errorf("an mp3 request answered %d, want 400", refused.StatusCode)
	}

	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	part, _ := writer.CreateFormFile("file", "audio.wav")
	_, _ = part.Write(short)
	_ = writer.WriteField("model", "gpt-4o-transcribe")
	_ = writer.Close()
	stt := do(t, http.MethodPost, srv.URL+"/v1/audio/transcriptions", writer.FormDataContentType(), &form)
	var text map[string]string
	_ = json.NewDecoder(stt.Body).Decode(&text)
	if stt.StatusCode != http.StatusOK || text["text"] != CallerTranscript {
		t.Fatalf("transcription = %d %v", stt.StatusCode, text)
	}
}

// @scenario "The console lists recent calls with their turns"
func TestConsoleAPIListsCallsNewestFirstWithTurns(t *testing.T) {
	_, srv := newTestServer(t)
	for range 2 {
		client := dial(t, srv, "agent_1")
		client.send(t, map[string]string{"type": "conversation_initiation_client_data"})
		client.next(t)
		client.speak(t)
		_, frames := client.expectTurn(t)
		if frames == 0 {
			t.Fatal("the reply carried no audio")
		}
	}
	var body struct {
		Calls []Call `json:"calls"`
	}
	getJSON(t, srv.URL+"/_sim/api/calls", &body)
	if len(body.Calls) != 2 || body.Calls[0].ID != "conv_voicesim_0002" {
		t.Fatalf("calls = %+v, want two, newest first", body.Calls)
	}
	first := body.Calls[1]
	if len(first.Turns) != 1 || first.Turns[0].AgentText != AgentLines[0] || first.Turns[0].CallerFrames != 16 ||
		first.AgentFrames == 0 || len(first.Events) == 0 {
		t.Fatalf("call = %+v", first)
	}
	var status consoleStatus
	getJSON(t, srv.URL+"/_sim/api/status", &status)
	if status.Stack != "feat-x" || status.Calls != 2 {
		t.Fatalf("status = %+v", status)
	}
	if code := getJSON(t, srv.URL+"/v1/voices", nil); code != http.StatusNotFound {
		t.Errorf("an unfaked provider path answered %d, want 404", code)
	}
}

// @scenario "The call log is bounded"
func TestCallLogKeepsOnlyTheMostRecentCalls(t *testing.T) {
	var log callLog
	for range maxCalls + 5 {
		log.open("agent")
	}
	if log.len() != maxCalls || log.calls[0].ID != "conv_voicesim_0006" {
		t.Fatalf("log holds %d calls starting at %s", log.len(), log.calls[0].ID)
	}
}

func TestConsoleWithoutABundleNamesTheBuildCommand(t *testing.T) {
	s := newServer(Config{}, fstest.MapFS{})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), consoleBuildCommand) {
		t.Fatalf("GET / = %d %q", rec.Code, rec.Body.String())
	}
}
