package scenariorunner

import (
	"context"
	"errors"
	"fmt"
	"io"

	scenario "github.com/langwatch/scenario/go"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/services/scenariorunner/egress"
)

// IO is where the runner reads its job and writes its lines.
type IO struct {
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
}

// Run executes one job end to end and returns the exit code: 0 once the
// result line is written, 1 after the failure line. The result line is the
// last thing on stdout; logs go to stderr.
func Run(ctx context.Context, env Env, stdio IO) int {
	logger := newLogger(env, stdio.Stderr)
	defer func() { _ = logger.Sync() }()
	var telemetry *Telemetry
	line, err := runJob(ctx, runInput{env: env, stdin: stdio.Stdin, logger: logger, telemetry: &telemetry})
	if err != nil {
		message := FormatError(err)
		logger.Error("scenario execution failed", zap.String("err", message))
		flush(ctx, telemetry, logger)
		_, _ = fmt.Fprintln(stdio.Stdout, FailureLine(message))
		return 1
	}
	flush(ctx, telemetry, logger)
	_, _ = fmt.Fprintln(stdio.Stdout, line)
	return 0
}

type runInput struct {
	env       Env
	stdin     io.Reader
	logger    *zap.Logger
	telemetry **Telemetry
}

// runJob reads the job, then the runtime, then runs it: a job that does not
// parse fails before the environment is consulted, as in the Node child.
func runJob(ctx context.Context, in runInput) (string, error) {
	data, err := io.ReadAll(in.stdin)
	if err != nil {
		return "", err
	}
	job, err := ParseJob(data)
	if err != nil {
		return "", err
	}
	rt, err := readRuntime(in.env, in.logger)
	if err != nil {
		return "", err
	}
	if job.AgentTest != nil {
		answer, err := RunAgentTestTurn(ctx, job.AgentTest, rt)
		return answer.Line(), err
	}
	scenario.Configure(scenario.WithHeadless(true))
	telemetry, err := SetupTelemetry(ctx, TelemetryInput{
		ResourceAttributes: in.env.ResourceAttributes,
		ServiceName:        in.env.ServiceName,
		Endpoint:           rt.Endpoint,
		APIKey:             rt.APIKey,
	})
	*in.telemetry = telemetry
	if err != nil {
		in.logger.Warn("tracing setup failed; the run continues without exporting spans", zap.Error(err))
	}
	result, err := RunSimulation(ctx, job.Simulation, rt)
	return result.Line(), err
}

// readRuntime refuses to run without the telemetry destination or the
// egress policy: a default for either would report one customer's run into
// another deployment, or open the fence.
func readRuntime(env Env, logger *zap.Logger) (Runtime, error) {
	if env.LangWatchEndpoint == "" || env.LangWatchAPIKey == "" {
		return Runtime{}, errors.New("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env")
	}
	policy, err := egress.DecodePolicy(env.EgressPolicy)
	if err != nil {
		return Runtime{}, err
	}
	client := egress.NewClient(egress.ClientOptions{
		Validator:          egress.NewValidator(policy, nil),
		RejectUnauthorized: env.RejectUnauthorized,
		ExtraCAFile:        env.ExtraCAFile,
	})
	return Runtime{
		Endpoint:          env.LangWatchEndpoint,
		APIKey:            env.LangWatchAPIKey,
		Verbose:           env.Verbose,
		HTTP:              client,
		NLPInternalSecret: env.NLPInternalSecret,
		NLPTimeouts:       env.NLPTimeouts,
		Logger:            logger,
	}, nil
}

func flush(ctx context.Context, t *Telemetry, logger *zap.Logger) {
	if err := t.Flush(ctx); err != nil {
		logger.Warn("otel flush warning", zap.Error(err))
	}
}

// newLogger is JSON on stderr, bound to the parent's logger context so the
// runner's lines join the worker's by run id.
func newLogger(env Env, stderr io.Writer) *zap.Logger {
	level := zapcore.InfoLevel
	if env.LogLevel != "" {
		if parsed, err := zapcore.ParseLevel(env.LogLevel); err == nil {
			level = parsed
		}
	}
	encoder := zap.NewProductionEncoderConfig()
	encoder.TimeKey = "time"
	encoder.EncodeTime = zapcore.ISO8601TimeEncoder
	core := zapcore.NewCore(zapcore.NewJSONEncoder(encoder), zapcore.AddSync(stderr), level)
	fields := []zap.Field{zap.String("name", "langwatch:scenarios:child")}
	for _, f := range env.LogContext {
		fields = append(fields, zap.String(f.Key, f.Value))
	}
	return zap.New(core).With(fields...)
}
