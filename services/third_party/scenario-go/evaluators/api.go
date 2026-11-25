package evaluators

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	scenario "github.com/langwatch/scenario/go"
	"github.com/langwatch/scenario/go/internal/jsjson"
)

// DefaultAPITimeout bounds one evaluations API request.
const DefaultAPITimeout = 120 * time.Second

const savedEvaluatorPrefix = "evaluators/"

// Input is one input an evaluator reads.
type Input struct {
	ID       string `json:"id"`
	Required bool   `json:"required"`
}

// EvaluatorSpec is what the runner needs to know about an evaluator before
// running it.
type EvaluatorSpec struct {
	// EvaluatorID is the saved evaluator id, or the type when run by type.
	EvaluatorID string
	Name        string
	// Inputs are the inputs the evaluator reads, required ones first.
	Inputs []Input
	// ProducesPassed says whether it answers pass or fail (or only a score).
	ProducesPassed bool
}

// EvaluateRequest is one evaluate call.
type EvaluateRequest struct {
	EvaluatorRef string
	// Data holds the resolved inputs. Keys are written in Order, then any
	// remaining keys sorted.
	Data map[string]any
	// Order is the key order of Data in the request body.
	Order    []string
	Settings map[string]any
	// TraceID is the trace of the run's last turn, or "".
	TraceID string
}

// EvaluateResponse is the answer of POST /api/evaluations/{ref}/evaluate.
type EvaluateResponse struct {
	// Status is "processed", "skipped" or "error".
	Status  string          `json:"status"`
	Score   *float64        `json:"score"`
	Passed  *bool           `json:"passed"`
	Label   *string         `json:"label"`
	Details *string         `json:"details"`
	Cost    *scenario.Money `json:"cost"`
}

// API is the part of the LangWatch evaluations API the runner uses.
type API interface {
	// EvaluatorSpec describes an evaluator; nil when LangWatch does not
	// know it.
	EvaluatorSpec(ctx context.Context, ref string) (*EvaluatorSpec, error)
	// Evaluate runs one evaluator. Transport and HTTP failures are errors;
	// an evaluator failure is a response with status "error".
	Evaluate(ctx context.Context, req EvaluateRequest) (*EvaluateResponse, error)
}

// APIError is a failed evaluations API request.
type APIError struct{ Message string }

func (e *APIError) Error() string { return e.Message }

// ClientOptions configure a Client.
type ClientOptions struct {
	// HTTPClient sends the requests; it must not follow redirects, since the
	// key travels in a header. Defaults to a shared client that refuses them.
	HTTPClient *http.Client
	// Timeout bounds each request; default DefaultAPITimeout.
	Timeout time.Duration
}

// Client is the LangWatch evaluations API: the evaluator catalogue, saved
// evaluators and the evaluate call, with the headers the LangWatch SDKs
// send. The catalogue is loaded once per client.
type Client struct {
	base    *url.URL
	baseErr error
	lw      scenario.LangWatchConfig
	http    *http.Client
	timeout time.Duration

	catalogueOnce sync.Once
	catalogue     map[string]catalogueEntry
	catalogueErr  error
}

var (
	noRedirectOnce   sync.Once
	noRedirectClient *http.Client
)

var errRedirect = errors.New("redirect refused: the evaluations API key is not forwarded")

func sharedClient() *http.Client {
	noRedirectOnce.Do(func() {
		noRedirectClient = &http.Client{
			CheckRedirect: func(*http.Request, []*http.Request) error { return errRedirect },
		}
	})
	return noRedirectClient
}

// NewClient returns a client for the LangWatch project lw names; empty
// fields fall back to the environment.
func NewClient(lw scenario.LangWatchConfig, opts ClientOptions) *Client {
	lw = scenario.ResolveLangWatch(lw)
	c := &Client{lw: lw, http: opts.HTTPClient, timeout: opts.Timeout}
	if c.http == nil {
		c.http = sharedClient()
	}
	if c.timeout <= 0 {
		c.timeout = DefaultAPITimeout
	}
	c.base, c.baseErr = url.Parse(lw.Endpoint)
	return c
}

func (c *Client) url(path string) (string, error) {
	if c.baseErr != nil {
		return "", c.baseErr
	}
	ref, err := url.Parse(path)
	if err != nil {
		return "", err
	}
	return c.base.ResolveReference(ref).String(), nil
}

func (c *Client) do(ctx context.Context, method, path string, body []byte) (*http.Response, context.CancelFunc, error) {
	u, err := c.url(path)
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, r)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.lw.APIKey)
	req.Header.Set("X-Auth-Token", c.lw.APIKey)
	if c.lw.ProjectID != "" {
		req.Header.Set("X-Project-Id", c.lw.ProjectID)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	return resp, cancel, nil
}

// getJSON GETs path into out; it reports false on a 404.
func (c *Client) getJSON(ctx context.Context, path string, out any) (bool, error) {
	resp, cancel, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return false, err
	}
	defer cancel()
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		text, _ := io.ReadAll(resp.Body)
		return false, &APIError{Message: "GET " + path + " answered " + strconv.Itoa(resp.StatusCode) + ": " + string(text)}
	}
	return true, json.NewDecoder(resp.Body).Decode(out)
}

type catalogueEntry struct {
	Name           string                     `json:"name"`
	RequiredFields []string                   `json:"requiredFields"`
	OptionalFields []string                   `json:"optionalFields"`
	Result         map[string]json.RawMessage `json:"result"`
}

func (c *Client) loadCatalogue(ctx context.Context) (map[string]catalogueEntry, error) {
	c.catalogueOnce.Do(func() {
		var body struct {
			Evaluators map[string]catalogueEntry `json:"evaluators"`
		}
		_, c.catalogueErr = c.getJSON(ctx, "/api/evaluations/list", &body)
		c.catalogue = body.Evaluators
	})
	return c.catalogue, c.catalogueErr
}

func specFromCatalogue(id, name string, e catalogueEntry) *EvaluatorSpec {
	if name == "" {
		name = e.Name
	}
	inputs := make([]Input, 0, len(e.RequiredFields)+len(e.OptionalFields))
	for _, f := range e.RequiredFields {
		inputs = append(inputs, Input{ID: f, Required: true})
	}
	for _, f := range e.OptionalFields {
		inputs = append(inputs, Input{ID: f})
	}
	_, passed := e.Result["passed"]
	return &EvaluatorSpec{EvaluatorID: id, Name: name, Inputs: inputs, ProducesPassed: passed}
}

type savedField struct {
	Identifier string `json:"identifier"`
	Optional   bool   `json:"optional"`
}

type savedEvaluator struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Config *struct {
		EvaluatorType string `json:"evaluatorType"`
	} `json:"config"`
	Fields       []*savedField `json:"fields"`
	OutputFields []*savedField `json:"outputFields"`
}

// specFromSavedFields reads the spec from the fields a saved evaluator
// declares; fields without an identifier are ignored.
func specFromSavedFields(s *savedEvaluator) *EvaluatorSpec {
	var required, optional []Input
	for _, f := range s.Fields {
		switch {
		case f == nil || f.Identifier == "":
		case f.Optional:
			optional = append(optional, Input{ID: f.Identifier})
		default:
			required = append(required, Input{ID: f.Identifier, Required: true})
		}
	}
	if len(required)+len(optional) == 0 {
		return nil
	}
	passed := false
	for _, f := range s.OutputFields {
		if f != nil && f.Identifier == "passed" {
			passed = true
		}
	}
	return &EvaluatorSpec{EvaluatorID: s.ID, Name: s.Name, Inputs: append(required, optional...), ProducesPassed: passed}
}

// EvaluatorSpec implements API. A built-in type is read from the catalogue;
// a saved evaluator from the fields its record declares, then from the
// catalogue entry of its type.
func (c *Client) EvaluatorSpec(ctx context.Context, ref string) (*EvaluatorSpec, error) {
	if !strings.HasPrefix(ref, savedEvaluatorPrefix) {
		catalogue, err := c.loadCatalogue(ctx)
		if err != nil {
			return nil, err
		}
		if e, ok := catalogue[ref]; ok {
			return specFromCatalogue(ref, "", e), nil
		}
		return nil, nil
	}
	var saved savedEvaluator
	found, err := c.getJSON(ctx, "/api/evaluators/"+url.PathEscape(strings.TrimPrefix(ref, savedEvaluatorPrefix)), &saved)
	if err != nil || !found {
		return nil, err
	}
	if spec := specFromSavedFields(&saved); spec != nil {
		return spec, nil
	}
	if saved.Config != nil && saved.Config.EvaluatorType != "" {
		catalogue, err := c.loadCatalogue(ctx)
		if err != nil {
			return nil, err
		}
		if e, ok := catalogue[saved.Config.EvaluatorType]; ok {
			return specFromCatalogue(saved.ID, saved.Name, e), nil
		}
	}
	return &EvaluatorSpec{EvaluatorID: saved.ID, Name: saved.Name, Inputs: []Input{}, ProducesPassed: true}, nil
}

// requestBody encodes {"data":…,"settings":…,"trace_id":…} in one pass.
func requestBody(req EvaluateRequest) []byte {
	b := make([]byte, 0, 256)
	b = append(b, `{"data":{`...)
	n := 0
	write := func(k string) {
		if n > 0 {
			b = append(b, ',')
		}
		n++
		b = jsjson.AppendString(b, k)
		b = append(b, ':')
		b = appendJSON(b, req.Data[k])
	}
	for _, k := range req.Order {
		if _, ok := req.Data[k]; ok {
			write(k)
		}
	}
	if n < len(req.Data) {
		for _, k := range sortedKeys(req.Data) {
			if !contains(req.Order, k) {
				write(k)
			}
		}
	}
	b = append(b, '}')
	if req.Settings != nil {
		b = append(b, `,"settings":`...)
		b = appendJSON(b, req.Settings)
	}
	b = append(b, `,"trace_id":`...)
	if req.TraceID == "" {
		b = append(b, "null"...)
	} else {
		b = jsjson.AppendString(b, req.TraceID)
	}
	return append(b, '}')
}

// Evaluate implements API.
func (c *Client) Evaluate(ctx context.Context, req EvaluateRequest) (*EvaluateResponse, error) {
	resp, cancel, err := c.do(ctx, http.MethodPost, "/api/evaluations/"+req.EvaluatorRef+"/evaluate", requestBody(req))
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		text, _ := io.ReadAll(resp.Body)
		return nil, &APIError{Message: "Evaluation API answered " + strconv.Itoa(resp.StatusCode) + ": " + string(text)}
	}
	var out EvaluateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}
