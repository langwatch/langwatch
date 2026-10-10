package voicesim

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"net/http"
	"time"
)

// The audio every fake speaks: 16-bit little-endian mono PCM at 24 kHz, the
// format both the ElevenLabs agent socket and OpenAI's `pcm` speech use.
const (
	sampleRate    = 24_000
	callerToneHz  = 440
	agentToneHz   = 330
	toneAmplitude = 0.25 * math.MaxInt16
	// loudSample: a sample louder than this is speech; the SDK's idle frames are all zeros.
	loudSample = 512
	// endOfTurnSilent is 300 ms of silence after speech, which ends the caller's turn.
	endOfTurnSilent = sampleRate * 300 / 1000
	// agentFrameBytes is 100 ms of reply audio per outgoing audio event.
	agentFrameBytes = sampleRate / 10 * 2
)

// CallerTranscript is what voicesim "heard" on every caller turn and what its
// transcription endpoint answers: the audio is a tone, so there is nothing to hear.
const CallerTranscript = "This is the simulated caller speaking."

// AgentLines is the agent's script: turn n answers AgentLines[n % len].
var AgentLines = []string{
	"Hello, thanks for calling. How can I help you today?",
	"I can help with that. Could you tell me a little more?",
	"Thanks, that is all sorted for you. Is there anything else?",
	"You are welcome. Goodbye!",
}

// tone is pcm16 of a sine at hz whose length follows the text: 300 ms a word,
// between half a second and three seconds, so the same text always sounds the same.
func tone(text string, hz float64) []byte {
	words := 1
	for _, r := range text {
		if r == ' ' {
			words++
		}
	}
	seconds := min(max(float64(words)*0.3, 0.5), 3)
	samples := int(seconds * sampleRate)
	pcm := make([]byte, 0, samples*2)
	for i := range samples {
		v := int16(toneAmplitude * math.Sin(2*math.Pi*hz*float64(i)/sampleRate))
		pcm = binary.LittleEndian.AppendUint16(pcm, uint16(v))
	}
	return pcm
}

// turnDetector is voicesim's voice activity detection: a caller turn ends once
// speech has been followed by endOfTurnSilent samples of silence.
type turnDetector struct {
	heard  bool
	silent int
}

// feed takes one chunk of caller pcm16 and reports whether it ended a turn.
func (d *turnDetector) feed(pcm []byte) bool {
	if isLoud(pcm) {
		d.heard, d.silent = true, 0
		return false
	}
	if !d.heard {
		return false
	}
	d.silent += len(pcm) / 2
	if d.silent < endOfTurnSilent {
		return false
	}
	d.heard, d.silent = false, 0
	return true
}

func isLoud(pcm []byte) bool {
	for i := 0; i+1 < len(pcm); i += 2 {
		v := int16(binary.LittleEndian.Uint16(pcm[i:]))
		if v > loudSample || v < -loudSample {
			return true
		}
	}
	return false
}

// clientMessage is what the product's ElevenLabs client sends: a typed event,
// or a bare {"user_audio_chunk": base64} with no type.
type clientMessage struct {
	Type           string `json:"type"`
	UserAudioChunk string `json:"user_audio_chunk"`
}

// handleConversation is the ElevenLabs Conversational AI socket. The agent
// never greets; each caller turn gets a user_transcript, an agent_response and
// the reply's audio, then silence, which the SDK reads as the end of the turn.
func (s *Server) handleConversation(w http.ResponseWriter, r *http.Request) {
	ws, err := acceptWebSocket(w, r)
	if err != nil {
		return
	}
	defer ws.close()
	call := s.calls.open(r.URL.Query().Get("agent_id"))
	s.calls.event(call, "in", "connected")
	defer s.calls.update(call, func(c *Call) {
		ended := time.Now().UTC()
		c.EndedAt = &ended
	})
	turn := callerTurn{}
	for {
		raw, err := ws.readMessage()
		if err != nil {
			s.calls.event(call, "in", "closed")
			return
		}
		var msg clientMessage
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}
		if err := s.receive(callLine{ws: ws, call: call}, &turn, msg); err != nil {
			return
		}
	}
}

// callerTurn is the caller's turn in progress.
type callerTurn struct {
	detector turnDetector
	frames   int
}

// callLine is one open call and the socket it runs over.
type callLine struct {
	ws   *wsConn
	call *Call
}

func (s *Server) receive(line callLine, turn *callerTurn, msg clientMessage) error {
	call := line.call
	switch {
	case msg.UserAudioChunk != "":
		// An undecodable chunk reads as silence, which is what the provider would hear.
		pcm, _ := base64.StdEncoding.DecodeString(msg.UserAudioChunk)
		turn.frames++
		s.calls.update(call, func(c *Call) { c.CallerFrames++ })
		if !turn.detector.feed(pcm) {
			return nil
		}
		frames := turn.frames
		turn.frames = 0
		return s.answerTurn(line, frames)
	case msg.Type == "conversation_initiation_client_data":
		s.calls.event(call, "in", msg.Type)
		return s.send(line, "conversation_initiation_metadata", map[string]any{
			"conversation_initiation_metadata_event": map[string]string{
				"conversation_id":           call.ID,
				"agent_output_audio_format": "pcm_24000",
				"user_input_audio_format":   "pcm_24000",
			},
		})
	case msg.Type != "":
		s.calls.event(call, "in", msg.Type)
	}
	return nil
}

// answerTurn speaks the next scripted line: transcript first, so the SDK has it
// before the audio drains, then the audio in 100 ms events. The turn is logged
// before anything is sent, so a console read after the reply always sees it.
func (s *Server) answerTurn(callLine callLine, callerFrames int) error {
	ws, call := callLine.ws, callLine.call
	var audio []byte
	var line string
	s.calls.update(call, func(c *Call) {
		index := len(c.Turns)
		line = AgentLines[index%len(AgentLines)]
		audio = tone(line, agentToneHz)
		frames := (len(audio) + agentFrameBytes - 1) / agentFrameBytes
		c.AgentFrames += frames
		c.Turns = append(c.Turns, Turn{
			Index: index, At: time.Now().UTC(), CallerText: CallerTranscript, AgentText: line,
			CallerFrames: callerFrames, AgentFrames: frames,
		})
	})
	if err := s.send(callLine, "user_transcript", map[string]any{
		"user_transcription_event": map[string]string{"user_transcript": CallerTranscript},
	}); err != nil {
		return err
	}
	if err := s.send(callLine, "agent_response", map[string]any{
		"agent_response_event": map[string]string{"agent_response": line},
	}); err != nil {
		return err
	}
	for id, start := 1, 0; start < len(audio); id, start = id+1, start+agentFrameBytes {
		event := map[string]any{"audio_event": map[string]any{
			"audio_base_64": base64.StdEncoding.EncodeToString(audio[start:min(start+agentFrameBytes, len(audio))]),
			"event_id":      id,
		}}
		if err := s.write(ws, "audio", event); err != nil {
			return err
		}
	}
	return nil
}

// send writes one typed event and records it on the call.
func (s *Server) send(line callLine, kind string, body map[string]any) error {
	s.calls.event(line.call, "out", kind)
	return s.write(line.ws, kind, body)
}

func (s *Server) write(ws *wsConn, kind string, body map[string]any) error {
	body["type"] = kind
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return ws.writeFrame(opText, raw)
}
