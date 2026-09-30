package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// ragasLLMPrepares are the ragas metrics a judge model scores, as langevals'
// wrappers run them. Reference: dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §3.
func ragasLLMPrepares() map[string]func(json.RawMessage) (Score, error) {
	s := &ragasScorers{tokens: sync.OnceValues(rules.NewTokenCounter)}
	return map[string]func(json.RawMessage) (Score, error){
		"ragas/faithfulness":               WithSettings(rules.ParseRagasFaithfulnessSettings, s.faithfulness),
		"ragas/factual_correctness":        WithSettings(rules.ParseRagasFactualCorrectnessSettings, s.factualCorrectness),
		"ragas/response_context_recall":    WithSettings(rules.ParseRagasSettings, s.contextRecall),
		"ragas/response_context_precision": WithSettings(rules.ParseRagasSettings, s.contextPrecision),
		"ragas/response_relevancy":         WithSettings(rules.ParseRagasResponseRelevancySettings, s.responseRelevancy),
		"ragas/summarization_score":        WithSettings(rules.ParseRagasSettings, s.summarization),
		"ragas/rubrics_based_scoring":      WithSettings(rules.ParseRagasRubricsBasedScoringSettings, s.rubrics),
		"ragas/sql_query_equivalence":      WithSettings(rules.ParseRagasSettings, s.sqlEquivalence),
	}
}

// ragasScorers share one token counter, loaded on first use.
type ragasScorers struct {
	tokens func() (*rules.TokenCounter, error)
}

// overBudget is check_max_tokens: a skip when the texts the scorer reads add
// up to more tokens than the settings allow.
func (s *ragasScorers) overBudget(settings rules.RagasSettings, texts ...string) (*contract.Result, error) {
	counter, err := s.tokens()
	if err != nil {
		return nil, err
	}
	total := 0
	for _, text := range texts {
		total += counter.Count(settings.Model, text)
	}
	limit := min(settings.MaxTokens, rules.RagasMaxTokensHardLimit)
	if total <= limit {
		return nil, nil
	}
	skip := skippedResult(fmt.Sprintf("Total tokens exceed the maximum of %d: %d", limit, total))
	return &skip, nil
}

type ragasNLIVerdicts struct {
	Statements []struct {
		Statement string `json:"statement"`
		Reason    string `json:"reason"`
		Verdict   int64  `json:"verdict"`
	} `json:"statements"`
}

const ragasNoClaims = "No claims found in the output to measure faitfhulness against context, skipping entry."

func (s *ragasScorers) faithfulness(ctx context.Context, settings rules.RagasFaithfulnessSettings, in EntryRun) (contract.Result, error) {
	contexts, err := ragasStrings(in.Entry.Contexts)
	if err != nil {
		return contract.Result{}, err
	}
	run := ragasFaithfulnessRun{
		judge:      newRagasModel(in, settings.Model, 0),
		input:      ragasText(in.Entry.Input),
		output:     ragasText(in.Entry.Output),
		contexts:   slices.DeleteFunc(contexts, func(c string) bool { return c == "" }),
		autodetect: settings.AutodetectDontKnow,
	}
	if skip, err := s.overBudget(settings.RagasSettings, append([]string{run.input, run.output}, run.contexts...)...); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	return scoreFaithfulness(ctx, run)
}

// ragasFaithfulnessRun is one faithfulness entry, its contexts cleared of
// empty ones.
type ragasFaithfulnessRun struct {
	judge         ragasModel
	input, output string
	contexts      []string
	autodetect    bool
}

func scoreFaithfulness(ctx context.Context, run ragasFaithfulnessRun) (contract.Result, error) {
	var statements struct {
		Statements []string `json:"statements"`
	}
	if err := run.judge.generateOne(ctx, ragasCall{prompt: rules.RagasStatementGeneratorPrompt(), input: []rules.RagasField{
		{Name: "question", Value: run.input}, {Name: "answer", Value: run.output},
	}}, &statements); err != nil {
		return vendorResult(err)
	}
	if len(statements.Statements) == 0 {
		return skippedResult(ragasNoClaims), nil
	}
	var verdicts ragasNLIVerdicts
	if err := run.judge.generateOne(ctx, ragasCall{prompt: rules.RagasNLIStatementPrompt(), input: []rules.RagasField{
		{Name: "context", Value: strings.Join(run.contexts, "\n")}, {Name: "statements", Value: statements.Statements},
	}}, &verdicts); err != nil {
		return vendorResult(err)
	}
	values, details := verdicts.claims()
	score, ok := rules.RagasShareNonZero(values)
	if !ok {
		return skippedResult(ragasNoClaims), nil
	}
	if run.autodetect && score < 0.1 {
		if skip, err := isDontKnow(ctx, run); skip != nil || err != nil {
			return ragasSkip(skip, err)
		}
	}
	return scored(score, details), nil
}

// claims are the verdicts and the faithfulness wrapper's details of them.
func (v ragasNLIVerdicts) claims() ([]int64, string) {
	values := make([]int64, len(v.Statements))
	lines := make([]string, len(v.Statements))
	for i, s := range v.Statements {
		values[i] = s.Verdict
		//nolint:gocritic // Python's f-string wraps the claim in quotes raw, unescaped; %q would escape it.
		lines[i] = fmt.Sprintf("Claim: \"%s\"\nVerdict: %s\nScore: %d", s.Statement, s.Reason, s.Verdict)
	}
	return values, strings.Join(lines, "\n\n")
}

// isDontKnow is the wrapper's plain "I don't know" check: a skip when the
// model says the output is one.
func isDontKnow(ctx context.Context, run ragasFaithfulnessRun) (*contract.Result, error) {
	answer, err := run.judge.askPlain(ctx, ragasDontKnowPrompt(run.output))
	if err != nil || !strings.Contains(strings.ToLower(answer), "true") {
		return nil, err
	}
	skip := skippedResult("The output seems correctly to be an 'I don't know' statement given the provided contexts. Skipping faithfulness score.")
	return &skip, nil
}

// ragasDontKnowPrompt is the faithfulness wrapper's f-string, its source
// indentation kept.
func ragasDontKnowPrompt(output string) string {
	indent := strings.Repeat(" ", 24)
	return "\n" + indent + "You are an LLM evaluator. You are given an output generated by another LLM and you need to determine if it is a 'I don't know', 'I don't have the information', 'I couldn't find anything' or 'I can't help you' statement. If it is, return True, otherwise return False. Return nothing else, only True or False.\n\n" +
		indent + "Generated output:\n" + indent + "> " + output + "\n" + indent
}

// ragasClaimCheck is one verify_claims call: the premise, the claims and a
// verdict per answer.
type ragasClaimCheck struct {
	premise  string
	claims   []string
	verdicts []bool
}

// ragasClaimRequest decomposes text into claims and checks them against
// premise.
type ragasClaimRequest struct {
	decompose rules.RagasPrompt
	premise   string
	text      string
}

func (m ragasModel) checkClaims(ctx context.Context, req ragasClaimRequest) (ragasClaimCheck, error) {
	var claims struct {
		Claims []string `json:"claims"`
	}
	if err := m.generateOne(ctx, ragasCall{prompt: req.decompose, input: []rules.RagasField{{Name: "response", Value: req.text}}}, &claims); err != nil {
		return ragasClaimCheck{}, err
	}
	var verdicts ragasNLIVerdicts
	if err := m.generateOne(ctx, ragasCall{prompt: rules.RagasNLIStatementPrompt(), input: []rules.RagasField{
		{Name: "context", Value: req.premise}, {Name: "statements", Value: claims.Claims},
	}}, &verdicts); err != nil {
		return ragasClaimCheck{}, err
	}
	check := ragasClaimCheck{premise: req.premise, claims: claims.Claims}
	for _, v := range verdicts.Statements {
		check.verdicts = append(check.verdicts, v.Verdict != 0)
	}
	return check, nil
}

func (s *ragasScorers) factualCorrectness(ctx context.Context, settings rules.RagasFactualCorrectnessSettings, in EntryRun) (contract.Result, error) {
	output, expected := ragasText(in.Entry.Output), ragasText(in.Entry.ExpectedOutput)
	if skip, err := s.overBudget(settings.RagasSettings, "", output, expected); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	judge := newRagasModel(in, settings.Model, 0)
	decompose := rules.RagasClaimDecompositionPrompt(settings.Atomicity, settings.Coverage)
	precision, err := judge.checkClaims(ctx, ragasClaimRequest{decompose: decompose, premise: expected, text: output})
	if err != nil {
		return vendorResult(err)
	}
	checks := []ragasClaimCheck{precision}
	var recall ragasClaimCheck
	if settings.Mode != "precision" {
		if recall, err = judge.checkClaims(ctx, ragasClaimRequest{decompose: decompose, premise: output, text: expected}); err != nil {
			return vendorResult(err)
		}
		checks = append(checks, recall)
	}
	details, ok := factualDetails(checks)
	if !ok {
		return errorResult("IndexError", "list index out of range"), nil
	}
	return scored(rules.RagasFactualCorrectness(settings.Mode, precision.verdicts, recall.verdicts), details), nil
}

// factualDetails is the wrapper's breakdown; not ok where Python indexes
// past the claims because the model answered more verdicts than claims.
func factualDetails(checks []ragasClaimCheck) (string, bool) {
	var details strings.Builder
	for i, c := range checks {
		if len(c.verdicts) > len(c.claims) {
			return "", false
		}
		fmt.Fprintf(&details, "%s\nPremise: %s\nHypothesis list:\n", []string{"# Precision", "\n# Recall"}[i], c.premise)
		for j, verdict := range c.verdicts {
			fmt.Fprintf(&details, "- \"%s\": %s\n", c.claims[j], pyBool(verdict))
		}
	}
	return details.String(), true
}

func (s *ragasScorers) contextRecall(ctx context.Context, settings rules.RagasSettings, in EntryRun) (contract.Result, error) {
	contexts, err := ragasStrings(in.Entry.Contexts)
	if err != nil {
		return contract.Result{}, err
	}
	input, output, expected := ragasText(in.Entry.Input), ragasText(in.Entry.Output), ragasText(in.Entry.ExpectedOutput)
	if skip, err := s.overBudget(settings, append([]string{input, output, expected}, contexts...)...); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	var judged struct {
		Classifications []struct {
			Statement  string `json:"statement"`
			Reason     string `json:"reason"`
			Attributed int64  `json:"attributed"`
		} `json:"classifications"`
	}
	if err := newRagasModel(in, settings.Model, 0).generateOne(ctx, ragasCall{prompt: rules.RagasContextRecallPrompt(), input: []rules.RagasField{
		{Name: "question", Value: input}, {Name: "context", Value: strings.Join(contexts, "\n")}, {Name: "answer", Value: expected},
	}}, &judged); err != nil {
		return vendorResult(err)
	}
	values := make([]int64, len(judged.Classifications))
	lines := make([]string, len(judged.Classifications))
	for i, c := range judged.Classifications {
		values[i] = c.Attributed
		lines[i] = fmt.Sprintf("Statement: %s\nReason: %s\nAttributed: %d", c.Statement, c.Reason, c.Attributed)
	}
	score, ok := rules.RagasShareNonZero(values)
	if !ok {
		return contract.Result{}, errors.New("the context recall judgement returned no classifications, so there is no score")
	}
	return scored(score, strings.Join(lines, "\n\n")), nil
}

func (s *ragasScorers) contextPrecision(ctx context.Context, settings rules.RagasSettings, in EntryRun) (contract.Result, error) {
	input, answer := ragasText(in.Entry.Input), ragasText(in.Entry.ExpectedOutput)
	counted := []string{input, answer}
	if answer == "" {
		answer = ragasText(in.Entry.Output)
		counted = []string{input, answer}
	}
	if answer == "" {
		return skippedResult("Either output or expected_output must be provided."), nil
	}
	contexts, err := ragasStrings(in.Entry.Contexts)
	if err != nil {
		return contract.Result{}, err
	}
	if skip, err := s.overBudget(settings, append(counted, contexts...)...); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	judge := newRagasModel(in, settings.Model, 0)
	verdicts := make([]int64, len(contexts))
	for i, context := range contexts {
		var verification struct {
			Verdict int64 `json:"verdict"`
		}
		if err := judge.generateOne(ctx, ragasCall{prompt: rules.RagasContextPrecisionPrompt(), input: []rules.RagasField{
			{Name: "question", Value: input}, {Name: "context", Value: context}, {Name: "answer", Value: answer},
		}}, &verification); err != nil {
			return vendorResult(err)
		}
		verdicts[i] = verification.Verdict
	}
	score := rules.RagasAveragePrecision(verdicts)
	return contract.Result{Status: contract.StatusProcessed, Score: &score}, nil
}

func (s *ragasScorers) responseRelevancy(ctx context.Context, settings rules.RagasResponseRelevancySettings, in EntryRun) (contract.Result, error) {
	input, output := ragasText(in.Entry.Input), ragasText(in.Entry.Output)
	if skip, err := s.overBudget(settings.RagasSettings, input, output); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	outputs, err := newRagasModel(in, settings.Model, 0.7).generate(ctx, ragasCall{prompt: rules.RagasResponseRelevancePrompt(), input: []rules.RagasField{{Name: "response", Value: output}}, n: 3})
	if err != nil {
		return vendorResult(err)
	}
	answers, err := relevancyAnswers(outputs)
	if err != nil {
		return contract.Result{}, err
	}
	if !answers.anyQuestion {
		return skippedResult("No questions could be generated from output."), nil
	}
	questionVector, err := ragasEmbed(ctx, in.Models, channels.EmbeddingRequest{Model: settings.EmbeddingsModel, Inputs: []string{input}})
	if err != nil {
		return contract.Result{}, err
	}
	generatedVectors, err := ragasEmbed(ctx, in.Models, channels.EmbeddingRequest{Model: settings.EmbeddingsModel, Inputs: answers.questions})
	if err != nil {
		return contract.Result{}, err
	}
	similarities := rules.RagasCosineSimilarities(questionVector[0], generatedVectors)
	score := rules.RagasMean(similarities)
	if answers.allNoncommittal {
		score *= 0
	}
	return scored(score, fmt.Sprintf("Questions generated from output:\n\n%s\n\nSimilarity to original question: %s\nEvasive answer: %s",
		strings.Join(answers.lines, "\n"), rules.RagasNumpyArrayString(similarities), pyBool(answers.anyNoncommittal))), nil
}

// ragasRelevancyAnswers are the generated questions and their verdicts:
// all noncommittal zeroes the score, any shows in the details.
type ragasRelevancyAnswers struct {
	questions, lines                 []string
	allNoncommittal, anyNoncommittal bool
	anyQuestion                      bool
}

func relevancyAnswers(outputs []json.RawMessage) (ragasRelevancyAnswers, error) {
	answers := ragasRelevancyAnswers{allNoncommittal: true}
	for _, raw := range outputs {
		var answer struct {
			Question     string `json:"question"`
			Noncommittal int64  `json:"noncommittal"`
		}
		if err := json.Unmarshal(raw, &answer); err != nil {
			return answers, err
		}
		answers.questions = append(answers.questions, answer.Question)
		answers.lines = append(answers.lines, "- "+answer.Question)
		answers.allNoncommittal = answers.allNoncommittal && answer.Noncommittal != 0
		answers.anyNoncommittal = answers.anyNoncommittal || answer.Noncommittal != 0
		answers.anyQuestion = answers.anyQuestion || answer.Question != ""
	}
	return answers, nil
}

// ragasEmbed is one embeddings call, as langchain makes it per call site.
func ragasEmbed(ctx context.Context, models *Models, req channels.EmbeddingRequest) ([][]float64, error) {
	texts := req.Inputs
	resp, err := models.Embed(ctx, req)
	if err != nil {
		return nil, err
	}
	if len(resp.Vectors) != len(texts) {
		return nil, fmt.Errorf("the embeddings model answered %d vectors for %d texts", len(resp.Vectors), len(texts))
	}
	return resp.Vectors, nil
}

func (s *ragasScorers) summarization(ctx context.Context, settings rules.RagasSettings, in EntryRun) (contract.Result, error) {
	contexts, err := ragasStrings(in.Entry.Contexts)
	if err != nil {
		return contract.Result{}, err
	}
	summary := ragasText(in.Entry.Output)
	if skip, err := s.overBudget(settings, append([]string{"", summary}, contexts...)...); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	judge := newRagasModel(in, settings.Model, 0)
	text := strings.Join(contexts, "\n")
	var keyphrases struct {
		Keyphrases []string `json:"keyphrases"`
	}
	var questions struct {
		Questions []string `json:"questions"`
	}
	var answers struct {
		Answers []string `json:"answers"`
	}
	if err := judge.generateOne(ctx, ragasCall{prompt: rules.RagasExtractKeyphrasesPrompt(), input: []rules.RagasField{{Name: "text", Value: text}}}, &keyphrases); err != nil {
		return vendorResult(err)
	}
	if err := judge.generateOne(ctx, ragasCall{prompt: rules.RagasGenerateQuestionsPrompt(), input: []rules.RagasField{
		{Name: "text", Value: text}, {Name: "keyphrases", Value: keyphrases.Keyphrases},
	}}, &questions); err != nil {
		return vendorResult(err)
	}
	if err := judge.generateOne(ctx, ragasCall{prompt: rules.RagasGenerateAnswersPrompt(), input: []rules.RagasField{
		{Name: "summary", Value: summary}, {Name: "questions", Value: questions.Questions},
	}}, &answers); err != nil {
		return vendorResult(err)
	}
	qa, conciseness, ok := rules.RagasSummarizationScores(answers.Answers, text, summary)
	if !ok {
		return contract.Result{}, errors.New("the summarization judgement returned no answers, so there is no QA score")
	}
	return scored(qa*0.5+conciseness*0.5, fmt.Sprintf("QA Score: %.2f\nConciseness Score: %.2f", qa, conciseness)), nil
}

func (s *ragasScorers) rubrics(ctx context.Context, settings rules.RagasRubricsBasedScoringSettings, in EntryRun) (contract.Result, error) {
	input, output := ragasText(in.Entry.Input), ragasText(in.Entry.Output)
	if skip, err := s.overBudget(settings.RagasSettings, input, output, ragasText(in.Entry.ExpectedOutput)); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	rubrics := make([]rules.RagasField, len(settings.Rubrics))
	for i, rubric := range settings.Rubrics {
		rubrics[i] = rules.RagasField{Name: fmt.Sprintf("score%d_description", i+1), Value: rubric.Description}
	}
	var reference any
	if in.Entry.ExpectedOutput != nil {
		reference = *in.Entry.ExpectedOutput
	}
	var judged struct {
		Feedback string `json:"feedback"`
		Score    int64  `json:"score"`
	}
	if err := newRagasModel(in, settings.Model, 0).generateOne(ctx, ragasCall{prompt: rules.RagasRubricsPrompt(), input: []rules.RagasField{
		{Name: "user_input", Value: input}, {Name: "response", Value: output}, {Name: "reference", Value: reference}, {Name: "rubrics", Value: rubrics},
	}}, &judged); err != nil {
		return vendorResult(err)
	}
	score := float64(judged.Score)
	return contract.Result{Status: contract.StatusProcessed, Score: &score, Details: &judged.Feedback}, nil
}

func (s *ragasScorers) sqlEquivalence(ctx context.Context, settings rules.RagasSettings, in EntryRun) (contract.Result, error) {
	schemas, err := ragasStrings(in.Entry.ExpectedContexts)
	if err != nil {
		return contract.Result{}, err
	}
	output, expected := ragasText(in.Entry.Output), ragasText(in.Entry.ExpectedOutput)
	if skip, err := s.overBudget(settings, append([]string{"", output, expected}, schemas...)...); skip != nil || err != nil {
		return ragasSkip(skip, err)
	}
	var judged struct {
		Response    string `json:"response_query_explaination"`
		Reference   string `json:"reference_query_explaination"`
		Equivalence bool   `json:"equivalence"`
	}
	if err := newRagasModel(in, settings.Model, 0).generateOne(ctx, ragasCall{prompt: rules.RagasSQLEquivalencePrompt(), input: []rules.RagasField{
		{Name: "reference", Value: expected}, {Name: "response", Value: output}, {Name: "database_schema", Value: strings.Join(schemas, "\n")},
	}}, &judged); err != nil {
		return vendorResult(err)
	}
	details := fmt.Sprintf("Response query explaination: %s\nReference query explaination: %s\nEquivalence: %s", judged.Response, judged.Reference, pyBool(judged.Equivalence))
	return contract.Result{Status: contract.StatusProcessed, Passed: &judged.Equivalence, Details: &details}, nil
}

// ragasSkip answers overBudget's outcome: its skip, or its error.
func ragasSkip(skip *contract.Result, err error) (contract.Result, error) {
	if err != nil {
		return contract.Result{}, err
	}
	return *skip, nil
}

// ragasText is an optional entry field, None read as "".
func ragasText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// ragasStrings decodes a list-of-strings entry field; absent is empty.
func ragasStrings(raw json.RawMessage) ([]string, error) {
	var list []string
	if len(raw) == 0 {
		return nil, nil
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, errors.New("contexts must be a list of strings")
	}
	return list, nil
}

// pyBool is Python's str of a bool.
func pyBool(value bool) string {
	if value {
		return "True"
	}
	return "False"
}
