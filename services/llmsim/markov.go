package llmsim

import (
	mrand "math/rand/v2"
	"strings"
	"unicode"
)

// corpus is self-written prose, so the chain carries no copyright question.
const corpus = `The model reads the question and weighs every word before it answers.
A good answer names the problem, then the fix, then the reason the fix holds.
The trace shows each step the agent took, and the evaluator scores the result.
When the tool returns an error, the agent tries again with a smaller request.
Every prompt is a small contract between the person asking and the system answering.
The dataset holds a thousand examples, and each example teaches the judge a little more.
Latency matters more than people expect, because a slow answer feels like a wrong one.
The gateway routes the call to the provider, counts the tokens and records the cost.
A careful team tests the agent with scenarios before it ever meets a real customer.
The weather turned grey over the bay, and the boats came in early that evening.
She wrote the plan on a single page, because a plan that needs two pages is two plans.
The river runs past the old mill, where the water turns the wheel as it always has.
Nobody remembers who planted the orchard, but everyone knows when the apples are ready.
The simulator answers quickly, costs nothing, and never pretends to be certain.
Short sentences travel further than long ones, and plain words travel furthest of all.
The engineer read the log twice, found the missing line, and wrote a test for it.
A monitor watches the stream of traces and raises a flag when the scores drift.
The judge compares the output with the expected answer and explains its verdict.
Small steps, taken in order, arrive sooner than one large leap taken in a hurry.
The library was quiet except for the clock, which ticked as if it had somewhere to be.
Each evaluation run leaves a record, so the next person can see what changed and why.
The agent asked for the customer's order number, checked the status, and replied politely.
Good defaults save more time than clever options, because most people never change them.
The prompt was rewritten three times until the answers stopped wandering off the subject.
The cost view adds up every token, and the total is always smaller than the worry.
When the tests pass, the team ships; when they fail, the team reads before it writes.
The lighthouse keeper counted the ships by night and the gulls by day.
A structured answer fits the schema, and a schema that fits the problem is half the work.
The conversation went on for a while, and every reply stayed close to the question.
Morning light fell across the desk, over the notes, the cold tea and the open laptop.`

// markov is a first-order word chain: each word lists the words that follow it.
type markov struct {
	next   map[string][]string
	starts []string
}

func newMarkov(text string) *markov {
	m := &markov{next: map[string][]string{}}
	words := strings.Fields(text)
	for i, w := range words {
		if i == 0 || strings.HasSuffix(words[i-1], ".") {
			m.starts = append(m.starts, w)
		}
		if i+1 < len(words) {
			m.next[w] = append(m.next[w], words[i+1])
		}
	}
	return m
}

// text walks the chain from a seeded start until it has about want words and
// has finished a sentence, never passing maxTokens (one word, one token).
// truncated reports that maxTokens cut it short.
func (m *markov) text(r *mrand.Rand, want, maxTokens int) (out string, truncated bool) {
	var words []string
	w := m.starts[r.IntN(len(m.starts))]
	for {
		if maxTokens > 0 && len(words) >= maxTokens {
			return strings.Join(words, " "), true
		}
		words = append(words, w)
		if len(words) >= want && strings.HasSuffix(w, ".") {
			return strings.Join(words, " "), false
		}
		followers := m.next[w]
		if len(followers) == 0 {
			w = m.starts[r.IntN(len(m.starts))]
			continue
		}
		w = followers[r.IntN(len(followers))]
	}
}

// phrase is a few words without the trailing full stop, for JSON strings.
func (m *markov) phrase(r *mrand.Rand, words int) string {
	s, _ := m.text(r, 1, words)
	return strings.TrimRightFunc(s, func(c rune) bool { return unicode.IsPunct(c) })
}

// tokens estimates a text's token count: a word each, or six characters a
// token for text with few spaces (JSON, code).
func tokens(s string) int {
	return max(len(strings.Fields(s)), len(s)/6)
}
