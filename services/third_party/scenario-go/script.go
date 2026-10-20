package scenario

import "context"

// ScriptStep is one step of a scenario script. Steps drive the run through
// the Executor's methods; a step concludes the scenario by setting a result
// (Succeed, Fail, a judge verdict). Other packages add steps by implementing
// this interface, for example voice steps (sleep, silence, audio, dtmf,
// interrupt) built on Executor.AgentNonBlocking and Executor.AddMessage.
//
// Returning an *AssertionError fails the run as a failed check; any other
// error ends it as an error.
type ScriptStep interface {
	Run(ctx context.Context, ex *Executor) error
}

// StepFunc adapts a function to a ScriptStep.
type StepFunc func(ctx context.Context, ex *Executor) error

// Run implements ScriptStep.
func (f StepFunc) Run(ctx context.Context, ex *Executor) error { return f(ctx, ex) }

// User adds a user turn: the given text, or a message the user simulator
// generates when called without text.
func User(text ...string) ScriptStep {
	content := first(text)
	return StepFunc(func(ctx context.Context, ex *Executor) error { return ex.User(ctx, content) })
}

// Agent adds an agent turn: the given text, or the response of the agent
// under test when called without text.
func Agent(text ...string) ScriptStep {
	content := first(text)
	return StepFunc(func(ctx context.Context, ex *Executor) error { return ex.Agent(ctx, content) })
}

// MessageStep adds a message: a user message takes the user turn, an
// assistant message the agent turn, other roles (tool, system) are added
// as they are. It is the JS SDK's message() step.
func MessageStep(m Message) ScriptStep {
	return StepFunc(func(ctx context.Context, ex *Executor) error { return ex.Message(ctx, m) })
}

// JudgeOption configures a Judge step.
type JudgeOption func(*JudgmentRequest)

// WithCriteria makes the judge step a checkpoint on these criteria instead
// of the judge's own: when they pass the script continues, when any fails
// the scenario fails.
func WithCriteria(criteria ...string) JudgeOption {
	return func(r *JudgmentRequest) { r.Criteria = append([]string{}, criteria...) }
}

// WithAdditionalContext shows the judge extra context, such as command
// output gathered by a custom step, under <additional_context>.
func WithAdditionalContext(text string) JudgeOption {
	return func(r *JudgmentRequest) { r.AdditionalContext = text }
}

// Judge asks the judge for a verdict now. Without criteria it ends the
// scenario with the judge's verdict on its own criteria.
func Judge(opts ...JudgeOption) ScriptStep {
	var req JudgmentRequest
	for _, o := range opts {
		o(&req)
	}
	return StepFunc(func(ctx context.Context, ex *Executor) error {
		_, err := ex.Judge(ctx, req)
		return err
	})
}

// ProceedOption configures a Proceed step.
type ProceedOption func(*ProceedOptions)

// Turns limits Proceed to n turns.
func Turns(n int) ProceedOption { return func(o *ProceedOptions) { o.Turns = n } }

// OnTurn runs fn at the start of every new turn.
func OnTurn(fn StateCallback) ProceedOption { return func(o *ProceedOptions) { o.OnTurn = fn } }

// OnStep runs fn after every agent interaction.
func OnStep(fn StateCallback) ProceedOption { return func(o *ProceedOptions) { o.OnStep = fn } }

// Proceed lets the agents converse on their own: for the given number of
// turns, or until the judge concludes or MaxTurns is reached.
func Proceed(opts ...ProceedOption) ScriptStep {
	var po ProceedOptions
	for _, o := range opts {
		o(&po)
	}
	return StepFunc(func(ctx context.Context, ex *Executor) error {
		_, err := ex.Proceed(ctx, po)
		return err
	})
}

// Succeed ends the scenario as successful.
func Succeed(reasoning ...string) ScriptStep {
	r := first(reasoning)
	return StepFunc(func(ctx context.Context, ex *Executor) error {
		ex.Succeed(ctx, r)
		return nil
	})
}

// Fail ends the scenario as failed.
func Fail(reasoning ...string) ScriptStep {
	r := first(reasoning)
	return StepFunc(func(ctx context.Context, ex *Executor) error {
		ex.Fail(ctx, r)
		return nil
	})
}

func first(s []string) string {
	if len(s) > 0 {
		return s[0]
	}
	return ""
}
