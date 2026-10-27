package lambdasim

import (
	"cmp"
	"encoding/json"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Every function lives in one fake account and region; only Invoke ever reads the ARN back.
const (
	fakeRegion  = "us-east-1"
	fakeAccount = "000000000000"
	logGroupDir = "/aws/lambda/"
)

// function is one Lambda function's configuration, in the field names the SDK reads.
type function struct {
	FunctionName     string            `json:"FunctionName"`
	FunctionArn      string            `json:"FunctionArn"`
	Role             string            `json:"Role,omitempty"`
	PackageType      string            `json:"PackageType,omitempty"`
	Timeout          int               `json:"Timeout"`
	MemorySize       int               `json:"MemorySize"`
	Architectures    []string          `json:"Architectures,omitempty"`
	Environment      environment       `json:"Environment"`
	State            string            `json:"State"`
	LastUpdateStatus string            `json:"LastUpdateStatus"`
	LastModified     string            `json:"LastModified"`
	Version          string            `json:"Version"`
	ImageURI         string            `json:"-"`
	Tags             map[string]string `json:"-"`
	lastInvoked      time.Time
}

type environment struct {
	Variables map[string]string `json:"Variables"`
}

func newFunction(name string) *function {
	return &function{
		FunctionName: name, FunctionArn: "arn:aws:lambda:" + fakeRegion + ":" + fakeAccount + ":function:" + name,
		PackageType: "Image", Timeout: 3, MemorySize: 128, State: "Active", LastUpdateStatus: "Successful",
		Version: "$LATEST", Environment: environment{Variables: map[string]string{}}, LastModified: lambdaTime(time.Now()),
	}
}

// lambdaTime is Lambda's LastModified spelling.
func lambdaTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000-0700") }

// functionName reads a name, a partial ARN or a full ARN, dropping any qualifier.
func functionName(raw string) string {
	if i := strings.Index(raw, ":function:"); i >= 0 {
		raw = raw[i+len(":function:"):]
	}
	name, _, _ := strings.Cut(raw, ":")
	return name
}

// lookup is a function by name or ARN, or nil.
func (s *Server) lookup(raw string) *function {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.functions[functionName(raw)]
}

// snapshot copies a function under the lock, so a handler never encodes it half-written.
func (s *Server) snapshot(fn *function) function {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := *fn
	c.Environment.Variables = maps.Clone(fn.Environment.Variables)
	return c
}

func notFound(w http.ResponseWriter, raw string) {
	writeAWSError(w, http.StatusNotFound, "ResourceNotFoundException",
		"Function not found: arn:aws:lambda:"+fakeRegion+":"+fakeAccount+":function:"+functionName(raw))
}

func (s *Server) handleGetFunction(w http.ResponseWriter, r *http.Request) {
	fn := s.lookup(r.PathValue("name"))
	if fn == nil {
		notFound(w, r.PathValue("name"))
		return
	}
	c := s.snapshot(fn)
	writeJSON(w, http.StatusOK, map[string]any{
		"Configuration": c,
		"Code":          map[string]string{"ImageUri": c.ImageURI, "RepositoryType": "ECR"},
		"Tags":          c.Tags,
	})
}

func (s *Server) handleGetConfiguration(w http.ResponseWriter, r *http.Request) {
	fn := s.lookup(r.PathValue("name"))
	if fn == nil {
		notFound(w, r.PathValue("name"))
		return
	}
	writeJSON(w, http.StatusOK, s.snapshot(fn))
}

func (s *Server) handleListFunctions(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	all := make([]function, 0, len(s.functions))
	for _, fn := range s.functions {
		all = append(all, *fn)
	}
	s.mu.Unlock()
	slices.SortFunc(all, func(a, b function) int { return strings.Compare(a.FunctionName, b.FunctionName) })
	// shortcut: one page whatever the size; add Marker paging if a sweep test ever needs it.
	writeJSON(w, http.StatusOK, map[string]any{"Functions": all})
}

// configurationUpdate is the subset of CreateFunction and UpdateFunctionConfiguration lambdasim keeps.
type configurationUpdate struct {
	FunctionName  string                    `json:"FunctionName"`
	Role          string                    `json:"Role"`
	PackageType   string                    `json:"PackageType"`
	Timeout       *int                      `json:"Timeout"`
	MemorySize    *int                      `json:"MemorySize"`
	Architectures []string                  `json:"Architectures"`
	Environment   *environment              `json:"Environment"`
	Code          struct{ ImageUri string } `json:"Code"`
	Tags          map[string]string         `json:"Tags"`
}

func (u configurationUpdate) applyTo(fn *function) {
	if u.Timeout != nil {
		fn.Timeout = *u.Timeout
	}
	if u.MemorySize != nil {
		fn.MemorySize = *u.MemorySize
	}
	if u.Environment != nil {
		fn.Environment.Variables = maps.Clone(u.Environment.Variables)
	}
	if u.Role != "" {
		fn.Role = u.Role
	}
	fn.LastModified = lambdaTime(time.Now())
}

func decodeBody(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(into); err != nil {
		writeAWSError(w, http.StatusBadRequest, "InvalidParameterValueException", "the body is not JSON: "+err.Error())
		return false
	}
	return true
}

func (s *Server) handleCreateFunction(w http.ResponseWriter, r *http.Request) {
	var req configurationUpdate
	if !decodeBody(w, r, &req) {
		return
	}
	if req.FunctionName == "" {
		writeAWSError(w, http.StatusBadRequest, "InvalidParameterValueException", "FunctionName is required")
		return
	}
	name := functionName(req.FunctionName)
	s.mu.Lock()
	if _, exists := s.functions[name]; exists {
		s.mu.Unlock()
		writeAWSError(w, http.StatusConflict, "ResourceConflictException", "Function already exist: "+name)
		return
	}
	fn := newFunction(name)
	req.applyTo(fn)
	fn.PackageType = cmp.Or(req.PackageType, fn.PackageType)
	fn.Architectures, fn.ImageURI, fn.Tags = req.Architectures, req.Code.ImageUri, req.Tags
	s.functions[name] = fn
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, s.snapshot(fn))
}

func (s *Server) handleUpdateCode(w http.ResponseWriter, r *http.Request) {
	var req struct{ ImageUri string }
	if !decodeBody(w, r, &req) {
		return
	}
	fn := s.lookup(r.PathValue("name"))
	if fn == nil {
		notFound(w, r.PathValue("name"))
		return
	}
	s.mu.Lock()
	fn.ImageURI, fn.LastModified = req.ImageUri, lambdaTime(time.Now())
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, s.snapshot(fn))
}

func (s *Server) handleUpdateConfiguration(w http.ResponseWriter, r *http.Request) {
	var req configurationUpdate
	if !decodeBody(w, r, &req) {
		return
	}
	fn := s.lookup(r.PathValue("name"))
	if fn == nil {
		notFound(w, r.PathValue("name"))
		return
	}
	s.mu.Lock()
	req.applyTo(fn)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, s.snapshot(fn))
}

func (s *Server) handleDeleteFunction(w http.ResponseWriter, r *http.Request) {
	name := functionName(r.PathValue("name"))
	s.mu.Lock()
	_, exists := s.functions[name]
	delete(s.functions, name)
	s.mu.Unlock()
	if !exists {
		notFound(w, name)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLogs answers the CloudWatch Logs operations the resolver and the sweep make.
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LogGroupName       string `json:"logGroupName"`
		LogGroupNamePrefix string `json:"logGroupNamePrefix"`
		RetentionInDays    int    `json:"retentionInDays"`
	}
	if !decodeLogs(w, r, &req) {
		return
	}
	operation := strings.TrimPrefix(r.Header.Get("X-Amz-Target"), "Logs_20140328.")
	s.mu.Lock()
	defer s.mu.Unlock()
	_, exists := s.logGroups[req.LogGroupName]
	switch operation {
	case "CreateLogGroup":
		if exists {
			writeLogsError(w, "ResourceAlreadyExistsException", "The specified log group already exists")
			return
		}
		s.logGroups[req.LogGroupName] = 0
		writeLogs(w, map[string]any{})
	case "PutRetentionPolicy", "DeleteLogGroup", "DescribeLogStreams":
		if !exists {
			writeLogsError(w, "ResourceNotFoundException", "The specified log group does not exist.")
			return
		}
		switch operation {
		case "PutRetentionPolicy":
			s.logGroups[req.LogGroupName] = req.RetentionInDays
			writeLogs(w, map[string]any{})
		case "DeleteLogGroup":
			delete(s.logGroups, req.LogGroupName)
			writeLogs(w, map[string]any{})
		default:
			writeLogs(w, map[string]any{"logStreams": s.logStreams(req.LogGroupName)})
		}
	case "DescribeLogGroups":
		groups := []map[string]any{}
		for _, name := range sortedKeys(s.logGroups) {
			if strings.HasPrefix(name, req.LogGroupNamePrefix) {
				groups = append(groups, map[string]any{"logGroupName": name, "retentionInDays": s.logGroups[name]})
			}
		}
		writeLogs(w, map[string]any{"logGroups": groups})
	default:
		writeLogsError(w, "UnknownOperationException", "lambdasim does not fake CloudWatch Logs "+operation)
	}
}

// logStreams is one stream whose last event is the function's last invoke; none before it ran. Holds s.mu.
func (s *Server) logStreams(group string) []map[string]any {
	fn := s.functions[strings.TrimPrefix(group, logGroupDir)]
	if fn == nil || fn.lastInvoked.IsZero() {
		return []map[string]any{}
	}
	return []map[string]any{{"logStreamName": "lambdasim", "lastEventTimestamp": fn.lastInvoked.UnixMilli()}}
}

func decodeLogs(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(into); err != nil {
		writeLogsError(w, "SerializationException", "the body is not JSON: "+err.Error())
		return false
	}
	return true
}

func writeLogs(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/x-amz-json-1.1")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(v)
}

// writeLogsError is JSON 1.1's error shape: 400 with the code in __type.
func writeLogsError(w http.ResponseWriter, code, message string) {
	w.Header().Set("Content-Type", "application/x-amz-json-1.1")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"__type": code, "message": message})
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return sortedStrings(keys)
}

func sortedStrings(in []string) []string {
	slices.Sort(in)
	return in
}
