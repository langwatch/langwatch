package services

import (
	"context"
	crand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// Clustering limits (design: dev/docs/plans/langevals-go/topic-clustering-go.md §2, §5, §9).
const (
	clusteringDeadline       = 11 * time.Minute
	embeddingBatchSize       = 20
	embeddingBatchesInFlight = 4
	embeddingFallbackWorkers = 8
	embeddingFailureLimit    = 3
	namingCallAttempts       = 4
	namingTaskAttempts       = 2
	namingRetryWait          = 12 * time.Second
	namingTasksInFlight      = 8
	emptyEmbeddingInput      = "<empty>"
	clusteringJobsPerPod     = 2 // plan §5.4
	clusteringBusyWait       = 5 * time.Second
)

// TopicClusteringDeps are the clustering service's collaborators. NewID,
// NewRand and Sleep default to crypto-random ids, a crypto-seeded source
// and a context-aware timer; tests fix them.
type TopicClusteringDeps struct {
	LLM             channels.LLMChannel
	Logger          *zap.Logger
	Deadline        time.Duration
	PriceEmbeddings bool // design §9 Q4: off reports today's cost
	NewID           func(prefix string) string
	NewRand         func() *rand.Rand
	Sleep           func(ctx context.Context, d time.Duration) error
	// MaxJobs caps clusterings in flight on this pod; a call past it waits up
	// to BusyWait, then answers evaluation_busy. Zero is 2 jobs and 5 s.
	MaxJobs  int
	BusyWait time.Duration
}

// TopicClusteringService clusters traces into named topics and subtopics.
type TopicClusteringService struct {
	deps TopicClusteringDeps
	jobs *slots
}

// NewTopicClusteringService builds the service.
func NewTopicClusteringService(deps TopicClusteringDeps) *TopicClusteringService {
	if deps.Logger == nil {
		deps.Logger = zap.NewNop()
	}
	if deps.Deadline == 0 {
		deps.Deadline = clusteringDeadline
	}
	if deps.NewID == nil {
		deps.NewID = nanoID
	}
	if deps.NewRand == nil {
		deps.NewRand = samplingRand
	}
	if deps.Sleep == nil {
		deps.Sleep = sleep
	}
	if deps.MaxJobs == 0 {
		deps.MaxJobs = clusteringJobsPerPod
	}
	if deps.BusyWait == 0 {
		deps.BusyWait = clusteringBusyWait
	}
	return &TopicClusteringService{deps: deps, jobs: newSlots(deps.MaxJobs, deps.BusyWait, "too many topic clusterings in flight")}
}

// samplingRand seeds the source that picks and shuffles naming samples.
func samplingRand() *rand.Rand {
	var seed [32]byte
	_, _ = crand.Read(seed[:])
	return rand.New(rand.NewChaCha8(seed)) //nolint:gosec // G404: shuffles naming samples, not a secret
}

// ClusterTopics runs one batch or incremental clustering.
func (s *TopicClusteringService) ClusterTopics(ctx context.Context, req contract.TopicClusteringRequest) (contract.TopicClusteringResult, error) {
	release, err := s.jobs.acquire(ctx)
	if err != nil {
		return contract.TopicClusteringResult{}, err
	}
	defer release()
	ctx, cancel := context.WithTimeout(ctx, s.deps.Deadline)
	defer cancel()
	run := &clusteringRun{deps: s.deps, req: req, rng: s.deps.NewRand()}
	var out rules.ClusteringResponse
	err = recovered(func() (err error) {
		switch req.Mode {
		case contract.ClusteringBatch:
			out, err = run.batch(ctx)
		case contract.ClusteringIncremental:
			out, err = run.incremental(ctx)
		default:
			err = fmt.Errorf("unknown clustering mode %q", req.Mode)
		}
		return err
	})()
	if err != nil {
		return contract.TopicClusteringResult{}, s.failure(ctx, req, err)
	}
	return contract.TopicClusteringResult{
		Topics:    orEmpty(out.Topics),
		Subtopics: orEmpty(out.Subtopics),
		Traces:    orEmpty(out.Traces),
		Cost:      contract.Money{Currency: "USD", Amount: run.cost},
	}, nil
}

// failure keeps a coded error and wraps anything else as a 500; the log
// carries no error text, since provider errors may quote content.
func (s *TopicClusteringService) failure(ctx context.Context, req contract.TopicClusteringRequest, err error) error {
	var coded herr.E
	if errors.As(err, &coded) {
		return err
	}
	s.deps.Logger.Warn("topic_clustering_failed",
		zap.String("project_id", req.Tenant.ProjectID),
		zap.String("mode", string(req.Mode)),
		zap.Bool("deadline_exceeded", errors.Is(err, context.DeadlineExceeded)),
		zap.Bool("panicked", errors.Is(err, errClusteringPanicked)),
	)
	return herr.New(ctx, contract.ErrTopicClusteringFailed, herr.M{"message": "topic clustering failed"}, err)
}

// errClusteringPanicked stands in for a recovered panic, whose value may
// quote trace content.
var errClusteringPanicked = errors.New("topic clustering panicked")

// recovered runs fn, turning a panic into errClusteringPanicked. Every
// goroutine the run starts goes through it: an unrecovered panic kills the pod.
func recovered(fn func() error) func() error {
	return func() (err error) {
		defer func() {
			if recover() != nil {
				err = errClusteringPanicked
			}
		}()
		return fn()
	}
}

type clusteringRun struct {
	deps TopicClusteringDeps
	req  contract.TopicClusteringRequest
	rng  *rand.Rand
	cost float64
}

func (r *clusteringRun) batch(ctx context.Context) (rules.ClusteringResponse, error) {
	traces, err := r.embedTraces(ctx)
	if err != nil {
		return rules.ClusteringResponse{}, err
	}
	if len(traces) < 2 {
		return rules.ClusteringResponse{}, herr.New(ctx, contract.ErrTopicClusteringTooFewTraces, herr.M{"message": "clustering needs at least 2 usable traces", "usable": len(traces)})
	}
	hierarchy, err := rules.BuildTopicHierarchy(traces, rules.MaximumTopicP95)
	if err != nil || len(hierarchy) == 0 {
		return rules.ClusteringResponse{}, err
	}
	return r.named(ctx, namingJob{hierarchy: hierarchy})
}

// incremental assigns traces to existing topics, then creates topics from
// the unassigned and subtopics under topics that gained enough traces.
func (r *clusteringRun) incremental(ctx context.Context) (rules.ClusteringResponse, error) {
	traces, err := r.embedTraces(ctx)
	if err != nil {
		return rules.ClusteringResponse{}, err
	}
	assignments := make([]contract.TraceTopicAssignment, len(traces))
	for i, trace := range traces {
		assignments[i] = rules.AssignTrace(trace, r.req.Topics, r.req.Subtopics)
	}
	rows, unassigned := splitAssigned(traces, assignments)
	var out rules.ClusteringResponse
	if rules.ShouldCreateTopics(len(unassigned)) {
		if out, err = r.newTopics(ctx, unassigned); err != nil {
			return rules.ClusteringResponse{}, err
		}
		rows = append(rows, out.Traces...)
	}
	grown, err := r.growSubtopics(ctx, rules.GroupTopicOnly(traces, assignments))
	if err != nil {
		return rules.ClusteringResponse{}, err
	}
	out.Subtopics = append(out.Subtopics, grown.Subtopics...)
	out.Traces = rules.MergeAssignments(append(rows, grown.Traces...))
	return out, nil
}

// splitAssigned keeps the rows of traces that matched a topic and returns
// the traces that matched none.
func splitAssigned(traces []rules.EmbeddedTrace, assignments []contract.TraceTopicAssignment) ([]contract.TraceTopicAssignment, []rules.EmbeddedTrace) {
	var rows []contract.TraceTopicAssignment
	var unassigned []rules.EmbeddedTrace
	for i, a := range assignments {
		if a.TopicID != nil {
			rows = append(rows, a)
		} else {
			unassigned = append(unassigned, traces[i])
		}
	}
	return rows, unassigned
}

func (r *clusteringRun) newTopics(ctx context.Context, unassigned []rules.EmbeddedTrace) (rules.ClusteringResponse, error) {
	hierarchy, err := rules.BuildTopicHierarchy(unassigned, rules.P95Ceiling(r.req.Topics))
	if err != nil || len(hierarchy) == 0 {
		return rules.ClusteringResponse{}, err
	}
	return r.named(ctx, namingJob{hierarchy: hierarchy, existing: namesOf(r.req.Topics)})
}

// growSubtopics creates subtopics under each topic with enough topic-only traces.
func (r *clusteringRun) growSubtopics(ctx context.Context, groups []rules.TopicOnlyGroup) (rules.ClusteringResponse, error) {
	var out rules.ClusteringResponse
	for _, group := range groups {
		if !rules.ShouldCreateSubtopics(len(group.Traces)) {
			continue
		}
		created, err := r.newSubtopics(ctx, group)
		if err != nil {
			return rules.ClusteringResponse{}, err
		}
		out.Subtopics = append(out.Subtopics, created.Subtopics...)
		out.Traces = append(out.Traces, created.Traces...)
	}
	return out, nil
}

func (r *clusteringRun) newSubtopics(ctx context.Context, group rules.TopicOnlyGroup) (rules.ClusteringResponse, error) {
	siblings := rules.ChildTopics(r.req.Subtopics, group.TopicID)
	clusters, err := rules.FlatClusters(group.Traces, rules.SubtopicDistance, rules.P95Ceiling(siblings))
	if err != nil || len(clusters) == 0 {
		return rules.ClusteringResponse{}, err
	}
	built, err := r.named(ctx, namingJob{hierarchy: []rules.TopicCluster{{Subtopics: clusters}}, existing: namesOf(siblings), standIn: true})
	if err != nil {
		return rules.ClusteringResponse{}, err
	}
	return rules.ReparentSubtopics(built, group.TopicID), nil
}

// named names a hierarchy and builds its response.
func (r *clusteringRun) named(ctx context.Context, job namingJob) (rules.ClusteringResponse, error) {
	topicNames, subtopicNames, err := r.nameAll(ctx, job)
	if err != nil {
		return rules.ClusteringResponse{}, err
	}
	return rules.BuildResponse(rules.ResponseInput{
		Hierarchy: job.hierarchy, TopicNames: topicNames, SubtopicNames: subtopicNames, NewID: r.deps.NewID,
	}), nil
}

// embedTraces embeds the usable traces and drops the ones that failed.
func (r *clusteringRun) embedTraces(ctx context.Context) ([]rules.EmbeddedTrace, error) {
	usable := rules.UsableTraces(r.req.Traces)
	texts := make([]string, len(usable))
	for i, t := range usable {
		texts[i] = t.Input
	}
	vectors, cost, err := r.embed(ctx, texts)
	if err != nil {
		return nil, err
	}
	r.cost += cost
	traces := make([]rules.EmbeddedTrace, 0, len(usable))
	for i, t := range usable {
		if vectors[i] != nil {
			traces = append(traces, rules.EmbeddedTrace{ClusteringTrace: t, Vector: vectors[i]})
		}
	}
	return traces, nil
}

// embed is generate_embeddings: batches of 20 (4 in flight); a failed batch
// restarts every text on the per-text path unless credentials are missing.
func (r *clusteringRun) embed(ctx context.Context, texts []string) ([][]float64, float64, error) {
	inputs := make([]string, len(texts))
	for i, t := range texts {
		inputs[i] = t
		if t == "" {
			inputs[i] = emptyEmbeddingInput
		}
	}
	vectors := make([][]float64, len(inputs))
	costs := make([]float64, ceilDiv(len(inputs), embeddingBatchSize))
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(embeddingBatchesInFlight)
	for b := range costs {
		start, end := b*embeddingBatchSize, min((b+1)*embeddingBatchSize, len(inputs))
		group.Go(recovered(func() error {
			got, cost, err := r.embedCall(groupCtx, inputs[start:end])
			copy(vectors[start:end], got)
			costs[b] = cost
			return err
		}))
	}
	if err := group.Wait(); err != nil {
		if errors.Is(err, channels.ErrProviderNotConfigured) || errors.Is(err, errClusteringPanicked) || ctx.Err() != nil {
			return nil, 0, err
		}
		return r.embedEach(ctx, inputs)
	}
	return vectors, sum(costs), nil
}

// embedded is one text's per-text embedding outcome.
type embedded struct {
	vector []float64
	cost   float64
	err    error
}

// embedEach is generate_embeddings_threaded: one call per text, 8 at a time
// in chunks of 20; a failed text is nil, the third failure fails the run.
func (r *clusteringRun) embedEach(ctx context.Context, inputs []string) ([][]float64, float64, error) {
	results := make([]embedded, len(inputs))
	failures := &embedFailures{}
	for start := 0; start < len(inputs); start += embeddingBatchSize {
		end := min(start+embeddingBatchSize, len(inputs))
		if err := r.embedChunk(ctx, inputs[start:end], results[start:end]); err != nil {
			return nil, 0, err
		}
		if err := failures.count(ctx, results[start:end]); err != nil {
			return nil, 0, err
		}
	}
	if failures.total > 0 && failures.total == len(inputs) {
		return nil, 0, failures.last
	}
	vectors := make([][]float64, len(results))
	costs := make([]float64, len(results))
	for i, res := range results {
		vectors[i], costs[i] = res.vector, res.cost
	}
	return vectors, sum(costs), nil
}

// embedChunk records each text's outcome; only a panic is returned.
func (r *clusteringRun) embedChunk(ctx context.Context, inputs []string, results []embedded) error {
	var group errgroup.Group
	group.SetLimit(embeddingFallbackWorkers)
	for i := range inputs {
		group.Go(recovered(func() error {
			got, cost, err := r.embedCall(ctx, inputs[i:i+1])
			results[i] = embedded{vector: got[0], cost: cost, err: err}
			return nil
		}))
	}
	return group.Wait()
}

// embedFailures counts per-text failures in input order.
type embedFailures struct {
	total int
	last  error
}

// count adds a chunk's failures and fails at the third, or once ctx is done.
func (f *embedFailures) count(ctx context.Context, results []embedded) error {
	for _, res := range results {
		if res.err == nil {
			continue
		}
		f.total, f.last = f.total+1, res.err
		if f.total >= embeddingFailureLimit || ctx.Err() != nil {
			return res.err
		}
	}
	return nil
}

// embedCall makes one Embed call; its vectors are normalized to the
// requested dimensions, nil for any the provider left out.
func (r *clusteringRun) embedCall(ctx context.Context, inputs []string) ([][]float64, float64, error) {
	vectors := make([][]float64, len(inputs))
	resp, err := r.deps.LLM.Embed(ctx, channels.EmbeddingRequest{Tenant: r.req.Tenant, Model: r.req.EmbeddingsModel, Inputs: inputs})
	if err != nil {
		return vectors, 0, err
	}
	if len(resp.Vectors) != len(inputs) {
		return vectors, 0, fmt.Errorf("embeddings answered %d vectors for %d inputs", len(resp.Vectors), len(inputs))
	}
	for i, v := range resp.Vectors {
		if v != nil {
			vectors[i] = rules.NormalizeDimensions(v, r.dimensions())
		}
	}
	cost := 0.0
	if r.deps.PriceEmbeddings && resp.CostUSD != nil {
		cost = *resp.CostUSD
	}
	return vectors, cost, nil
}

func (r *clusteringRun) dimensions() int {
	if r.req.Dimensions > 0 {
		return r.req.Dimensions
	}
	return rules.EmbeddingDimensions
}

// namingJob is a hierarchy to name: existing names to avoid, and whether
// its one topic is a stand-in whose name is not asked.
type namingJob struct {
	hierarchy []rules.TopicCluster
	existing  []string
	standIn   bool
}

// nameAll is generate_topic_and_subtopic_names: one topic task (skipped
// under a stand-in topic) and one subtopic task per topic, concurrently.
func (r *clusteringRun) nameAll(ctx context.Context, job namingJob) ([]*string, [][]*string, error) {
	topicExamples := make([][]string, len(job.hierarchy))
	for i, topic := range job.hierarchy {
		topicExamples[i] = rules.TopicSamples(topic, r.rng)
	}
	subtopicExamples := make([][][]string, len(job.hierarchy))
	for i, topic := range job.hierarchy {
		subtopicExamples[i] = rules.SubtopicSamples(topic, r.rng)
	}
	topicNames := standInNames(len(job.hierarchy), job.standIn)
	subtopicNames := make([][]*string, len(job.hierarchy))
	costs := make([]float64, len(job.hierarchy)+1)
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(namingTasksInFlight)
	if !job.standIn {
		group.Go(recovered(func() (err error) {
			topicNames, costs[0], err = r.nameTask(groupCtx, topicExamples, job.existing)
			return err
		}))
	}
	for i := range job.hierarchy {
		group.Go(recovered(func() (err error) {
			subtopicNames[i], costs[i+1], err = r.nameTask(groupCtx, subtopicExamples[i], job.existing)
			return err
		}))
	}
	if err := group.Wait(); err != nil {
		return nil, nil, err
	}
	r.cost += sum(costs)
	return topicNames, subtopicNames, nil
}

// standInNames names every topic "New Sub Topics" under a stand-in, else nothing yet.
func standInNames(count int, standIn bool) []*string {
	names := make([]*string, count)
	if standIn {
		for i := range names {
			name := rules.StandInTopicName
			names[i] = &name
		}
	}
	return names
}

// nameTask is generate_topic_names_split_and_improve_similar_names: two
// attempts 12 s apart; a failed attempt's cost is lost.
func (r *clusteringRun) nameTask(ctx context.Context, examples [][]string, existing []string) ([]*string, float64, error) {
	var err error
	for attempt := range namingTaskAttempts {
		if attempt > 0 {
			if err := r.deps.Sleep(ctx, namingRetryWait); err != nil {
				return nil, 0, err
			}
		}
		var names []*string
		var cost float64
		if names, cost, err = r.nameAndDisambiguate(ctx, examples, existing); err == nil {
			return names, cost, nil
		}
	}
	return nil, 0, err
}

func (r *clusteringRun) nameAndDisambiguate(ctx context.Context, examples [][]string, existing []string) ([]*string, float64, error) {
	names := make([]*string, len(examples))
	namesCost := 0.0
	for _, batch := range rules.NamingBatches(examples) {
		got, cost, err := r.nameBatch(ctx, examples[batch[0]:batch[1]], existing)
		if err != nil {
			if ctx.Err() != nil {
				return nil, 0, ctx.Err()
			}
			continue
		}
		namesCost += cost
		for i, name := range got {
			names[batch[0]+i] = &name
		}
	}
	pairCost, err := r.disambiguate(ctx, names, examples)
	return names, namesCost + pairCost, err
}

// nameBatch is generate_topic_names: up to 4 attempts 12 s apart.
func (r *clusteringRun) nameBatch(ctx context.Context, batch [][]string, existing []string) ([]string, float64, error) {
	system, user := rules.NamesPrompt(batch, existing)
	req := r.namingRequest(system, user, rules.NamesTool(len(batch)))
	var err error
	for attempt := range namingCallAttempts {
		if attempt > 0 {
			if err := r.deps.Sleep(ctx, namingRetryWait); err != nil {
				return nil, 0, err
			}
		}
		names, cost, attemptErr := r.nameAttempt(ctx, req, len(batch))
		if attemptErr == nil {
			return names, cost, nil
		}
		err = attemptErr
	}
	return nil, 0, err
}

// nameAttempt is one naming call; a missing name fails it, and its cost with it.
func (r *clusteringRun) nameAttempt(ctx context.Context, req channels.CompletionRequest, count int) ([]string, float64, error) {
	resp, err := r.deps.LLM.Complete(ctx, req)
	if err != nil {
		return nil, 0, err
	}
	arguments, err := toolArguments(resp)
	if err != nil {
		return nil, 0, err
	}
	names, err := rules.ParseNames(arguments, count)
	if err != nil {
		return nil, 0, err
	}
	return names, r.completionCost(resp), nil
}

// disambiguate is improve_similar_names: up to 3 rounds renaming the closest
// pair of names while their distance is at most 0.6.
func (r *clusteringRun) disambiguate(ctx context.Context, names []*string, examples [][]string) (float64, error) {
	cost := 0.0
	for range rules.DisambiguationRounds {
		roundCost, renamed, err := r.disambiguateOnce(ctx, names, examples)
		if err != nil {
			return 0, err
		}
		cost += roundCost
		if !renamed {
			break
		}
	}
	return cost, nil
}

// disambiguateOnce embeds the names and renames the closest pair, if close enough.
func (r *clusteringRun) disambiguateOnce(ctx context.Context, names []*string, examples [][]string) (float64, bool, error) {
	vectors, embedCost, err := r.embed(ctx, textsOf(names))
	if err != nil {
		return 0, false, err
	}
	a, b, ok := rules.ClosestPair(names, vectors)
	if !ok {
		return embedCost, false, nil
	}
	system, user := rules.PairPrompt(
		rules.NamedExamples{Name: *names[a], Examples: examples[a]},
		rules.NamedExamples{Name: *names[b], Examples: examples[b]},
	)
	resp, err := r.deps.LLM.Complete(ctx, r.namingRequest(system, user, rules.PairTool()))
	if err != nil {
		return 0, false, err
	}
	arguments, err := toolArguments(resp)
	if err != nil {
		return 0, false, err
	}
	if names[a], names[b], err = rules.ParsePairNames(arguments); err != nil {
		return 0, false, err
	}
	return embedCost + r.completionCost(resp), true, nil
}

// textsOf is the names as embedding inputs, "" for a missing name.
func textsOf(names []*string) []string {
	texts := make([]string, len(names))
	for i, name := range names {
		if name != nil {
			texts[i] = *name
		}
	}
	return texts
}

func (r *clusteringRun) namingRequest(system, user string, tool json.RawMessage) channels.CompletionRequest {
	temperature := 0.0
	return channels.CompletionRequest{
		Tenant:      r.req.Tenant,
		Model:       r.req.ChatModel,
		Messages:    []channels.Message{{Role: "system", Content: system}, {Role: "user", Content: user}},
		Tools:       []json.RawMessage{tool},
		ToolChoice:  json.RawMessage(rules.NamingToolChoice),
		Temperature: &temperature,
	}
}

// completionCost prices a naming call; an unpriced model names at zero
// cost with a warning (design §9 Q5; Python produced no topics).
func (r *clusteringRun) completionCost(resp channels.CompletionResponse) float64 {
	if resp.CostUSD == nil {
		r.deps.Logger.Warn("topic_naming_model_unpriced", zap.String("project_id", r.req.Tenant.ProjectID), zap.String("model", r.req.ChatModel))
		return 0
	}
	return *resp.CostUSD
}

func toolArguments(resp channels.CompletionResponse) (string, error) {
	if len(resp.Choices) == 0 || len(resp.Choices[0].ToolCalls) == 0 {
		return "", errors.New("naming answer has no tool call")
	}
	return resp.Choices[0].ToolCalls[0].Arguments, nil
}

func namesOf(topics []contract.ClusteringTopic) []string {
	names := make([]string, len(topics))
	for i, t := range topics {
		names[i] = t.Name
	}
	return names
}

func sum(values []float64) float64 {
	total := 0.0
	for _, v := range values {
		total += v
	}
	return total
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func ceilDiv(a, b int) int { return (a + b - 1) / b }

// nanoID is nanoid's default: 21 characters of A-Za-z0-9_- from crypto/rand.
func nanoID(prefix string) string {
	const alphabet = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	id := make([]byte, 21)
	_, _ = crand.Read(id)
	for i := range id {
		id[i] = alphabet[id[i]&63]
	}
	return prefix + string(id)
}

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
