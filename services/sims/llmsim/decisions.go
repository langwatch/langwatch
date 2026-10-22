package llmsim

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"slices"
	"strings"
)

// The Instant Evals decision calls (ADR-182): OpenAI's Decisions API, the Jev body Inception,
// Perplexity and the hosted classifier take, and Cloudflare's Workers AI route that wraps Jev.
const dialectDecisions = "decisions"

// Decision wires, recorded as the call's mode; the names match the product's catalogue.
const (
	wireOpenAIDecisions = "openai_decisions"
	wireJev             = "jev"
	wireCloudflareJev   = "cloudflare_jev"
)

// isDecisionPath is whether a POST path is one of the decision routes.
func isDecisionPath(path string) bool {
	return strings.HasSuffix(path, "/v1/decisions") || strings.HasSuffix(path, "/v1/systemone") ||
		strings.Contains(path, "/ai/run/@cf/")
}

// decisionWireOf names the wire: Cloudflare by its path, OpenAI by its `input` field, else Jev.
func decisionWireOf(path string, body map[string]json.RawMessage) string {
	if strings.Contains(path, "/ai/run/@cf/") {
		return wireCloudflareJev
	}
	if _, ok := body["input"]; ok {
		return wireOpenAIDecisions
	}
	return wireJev
}

// maskedBearer keeps only the last four characters of a bearer token, so a driver can tell
// which key was sent without the sim holding it.
func maskedBearer(header string) string {
	token, ok := strings.CutPrefix(header, "Bearer ")
	switch {
	case header == "":
		return "none"
	case !ok:
		return "not a bearer token"
	case len(token) < 8:
		return "Bearer ..."
	}
	return "Bearer ..." + token[len(token)-4:]
}

// serveDecision answers one decision call: a queued nextJson verbatim, else a seeded answer per
// question. Cloudflare's answer goes inside its `result` envelope either way.
func (s *Server) serveDecision(pc *providerCall, r *http.Request, body map[string]json.RawMessage) {
	wire := decisionWireOf(pc.rec.Path, body)
	pc.rec.Dialect, pc.rec.Mode = dialectDecisions, wire
	if pc.rec.Model == "" {
		pc.rec.Model = pc.rec.Path[strings.LastIndex(pc.rec.Path, "/")+1:]
	}
	text := str(body["state"])
	if wire == wireOpenAIDecisions {
		text = str(body["input"])
	}
	pc.rec.InputTokens = tokens(text)
	answer, err := s.decisionAnswer(r.Header, decisionCall{
		wire: wire, model: pc.rec.Model, text: text, inputTokens: pc.rec.InputTokens,
		questions: body["questions"],
	})
	if err != nil {
		pc.fail(http.StatusBadRequest, err.Error())
		return
	}
	if wire == wireCloudflareJev {
		answer, _ = json.Marshal(cloudflareEnvelope{Result: answer, Success: true, Errors: []any{}, Messages: []any{}})
	}
	pc.rec.Answer = answer
	pc.w.Header().Set("Content-Type", "application/json")
	_, _ = pc.w.Write(answer)
}

type cloudflareEnvelope struct {
	Result   json.RawMessage `json:"result"`
	Success  bool            `json:"success"`
	Errors   []any           `json:"errors"`
	Messages []any           `json:"messages"`
}

type decisionCall struct {
	wire, model, text string
	inputTokens       int
	questions         json.RawMessage
}

type decisionUsage struct {
	InputTokens int `json:"input_tokens"`
}

func (s *Server) decisionAnswer(h http.Header, call decisionCall) (json.RawMessage, error) {
	if next, ok := s.popNextJSON(); ok {
		return json.RawMessage(next), nil
	}
	if call.wire == wireOpenAIDecisions {
		return s.openAIDecisionAnswer(h, call)
	}
	return s.jevAnswer(h, call)
}

// draw is one question's seeded random source: the model, the text and the question id.
func (s *Server) draw(h http.Header, call decisionCall, id string) decisionDraw {
	rng := s.rng(h, request{model: call.model, seedBytes: []byte(call.text + "\x00" + id)})
	return decisionDraw{probability: round3(rng.Float64()), confidence: round3(0.5 + rng.Float64()/2), pick: rng.IntN}
}

type decisionDraw struct {
	probability, confidence float64
	pick                    func(n int) int
}

func round3(x float64) float64 { return math.Round(x*1000) / 1000 }

type jevQuestion struct {
	Type     string          `json:"type"`
	Criteria json.RawMessage `json:"criteria"`
}

// jevAnswerBody is one Jev answer; a score is the chosen level's position, as Jev counts it.
type jevAnswerBody struct {
	Type       string   `json:"type"`
	Noul       *float64 `json:"noul,omitempty"`
	Choice     *string  `json:"choice,omitempty"`
	Score      *int     `json:"score,omitempty"`
	Confidence float64  `json:"confidence"`
}

func (s *Server) jevAnswer(h http.Header, call decisionCall) (json.RawMessage, error) {
	var questions map[string]jevQuestion
	if err := json.Unmarshal(call.questions, &questions); err != nil || len(questions) == 0 {
		return nil, errors.New("questions is an object of named questions")
	}
	answers := make(map[string]jevAnswerBody, len(questions))
	for id, q := range questions {
		d := s.draw(h, call, id)
		a := jevAnswerBody{Type: q.Type, Confidence: d.confidence}
		switch q.Type {
		case "noul":
			a.Noul = &d.probability
		case "score":
			var levels []string
			if json.Unmarshal(q.Criteria, &levels) == nil && len(levels) > 0 {
				pos := d.pick(len(levels))
				a.Score = &pos
			}
		case "choice":
			var options map[string]string
			if json.Unmarshal(q.Criteria, &options) == nil && len(options) > 0 {
				names := make([]string, 0, len(options))
				for name := range options {
					names = append(names, name)
				}
				slices.Sort(names)
				a.Choice = &names[d.pick(len(names))]
			}
		}
		answers[id] = a
	}
	return json.Marshal(struct {
		Model   string                   `json:"model"`
		Answers map[string]jevAnswerBody `json:"answers"`
		Usage   decisionUsage            `json:"usage"`
	}{call.model, answers, decisionUsage{call.inputTokens}})
}

type openAIDecisionQuestion struct {
	Type   string `json:"type"`
	Name   string `json:"name"`
	Levels []struct {
		Label string `json:"label"`
	} `json:"levels"`
	Choices []struct {
		Value json.RawMessage `json:"value"`
	} `json:"choices"`
}

// openAIDecisionAnswerBody is one named answer; a score is the chosen level's position.
type openAIDecisionAnswerBody struct {
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	Probability *float64        `json:"probability,omitempty"`
	Score       *int            `json:"score,omitempty"`
	Choice      json.RawMessage `json:"choice,omitempty"`
	Confidence  float64         `json:"confidence"`
}

func (s *Server) openAIDecisionAnswer(h http.Header, call decisionCall) (json.RawMessage, error) {
	var questions []openAIDecisionQuestion
	if err := json.Unmarshal(call.questions, &questions); err != nil || len(questions) == 0 {
		return nil, errors.New("questions is a list of named questions")
	}
	answers := make([]openAIDecisionAnswerBody, 0, len(questions))
	for _, q := range questions {
		d := s.draw(h, call, q.Name)
		a := openAIDecisionAnswerBody{Type: q.Type, Name: q.Name, Confidence: d.confidence}
		switch {
		case q.Type == "predicate":
			a.Probability = &d.probability
		case q.Type == "score" && len(q.Levels) > 0:
			pos := d.pick(len(q.Levels))
			a.Score = &pos
		case q.Type == "choice" && len(q.Choices) > 0:
			a.Choice = q.Choices[d.pick(len(q.Choices))].Value
		}
		answers = append(answers, a)
	}
	return json.Marshal(struct {
		Model   string                     `json:"model"`
		Answers []openAIDecisionAnswerBody `json:"answers"`
		Usage   decisionUsage              `json:"usage"`
	}{call.model, answers, decisionUsage{call.inputTokens}})
}
