package voicesim

import "time"

// seedAgentID names the sample call's agent, so a seeded call is easy to tell apart.
const seedAgentID = "agent_voicesim_seed"

// seedCall records one finished two-turn call, the shape a real call leaves,
// so the console starts with content (VOICESIM_SEED=1).
func (s *Server) seedCall() {
	call := s.calls.open(seedAgentID)
	for _, kind := range []string{"connected", "conversation_initiation_client_data"} {
		s.calls.event(call, "in", kind)
	}
	s.calls.event(call, "out", "conversation_initiation_metadata")
	s.calls.update(call, func(c *Call) {
		at := c.StartedAt
		for index := range 2 {
			line := AgentLines[index]
			frames := (len(tone(line, agentToneHz)) + agentFrameBytes - 1) / agentFrameBytes
			c.Turns = append(c.Turns, Turn{
				Index: index, At: at, CallerText: CallerTranscript, AgentText: line,
				CallerFrames: 10, AgentFrames: frames,
			})
			c.CallerFrames += 10
			c.AgentFrames += frames
		}
		ended := at.Add(10 * time.Second)
		c.EndedAt = &ended
	})
	s.calls.event(call, "in", "closed")
}
