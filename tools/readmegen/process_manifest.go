package readmegen

// Scalar is a value the extractor folded, or the source text it could not fold.
type Scalar struct {
	Value    string `json:"value"`
	Text     string `json:"text"`
	Resolved bool   `json:"resolved"`
	File     string `json:"file"`
}

// String is the folded value, or the source text marked ≈.
func (s Scalar) String() string {
	if s.Resolved {
		return s.Value
	}
	if s.Text == "" {
		return "≈"
	}
	return "≈ " + s.Text
}

// SchemaRef names the schema a route or procedure reads or answers with.
type SchemaRef struct {
	Role   string   `json:"role"`
	Name   string   `json:"name"`
	Inline bool     `json:"inline"`
	At     Location `json:"at"`
}

// Gate is what a route or procedure asks before its handler runs.
type Gate struct {
	Kind     string `json:"kind"`
	Detail   string `json:"detail"`
	Resolved bool   `json:"resolved"`
}

// Entitlement is a `.withEntitlement(entitlement, { feature })` declaration.
type Entitlement struct {
	Entitlement string `json:"entitlement"`
	Feature     string `json:"feature"`
}

// RestRoute is one route of a REST family.
type RestRoute struct {
	Method      string       `json:"method"`
	Methods     []string     `json:"methods"`
	AnyMethod   bool         `json:"anyMethod"`
	Path        Scalar       `json:"path"`
	Operation   Scalar       `json:"operation"`
	Version     string       `json:"version"`
	Credential  string       `json:"credential"`
	Gate        Gate         `json:"gate"`
	Entitlement *Entitlement `json:"entitlement"`
	Hidden      bool         `json:"hidden"`
	Deprecated  bool         `json:"deprecated"`
	Summary     string       `json:"summary"`
	Schemas     []SchemaRef  `json:"schemas"`
	At          Location     `json:"at"`
}

// RestFamily is one `defineRestRouter(...)` chain.
type RestFamily struct {
	Name       string      `json:"name"`
	Namespace  Scalar      `json:"namespace"`
	Version    Scalar      `json:"version"`
	Addressing string      `json:"addressing"`
	V1Twin     bool        `json:"v1Twin"`
	Generation string      `json:"generation"`
	Credential string      `json:"credential"`
	Deprecated bool        `json:"deprecated"`
	Routes     []RestRoute `json:"routes"`
	At         Location    `json:"at"`
}

// TrpcProcedure is one contract procedure joined with its router half by name.
type TrpcProcedure struct {
	Name        string       `json:"name"`
	Kind        string       `json:"kind"`
	Gate        Gate         `json:"gate"`
	Entitlement *Entitlement `json:"entitlement"`
	Input       *SchemaRef   `json:"input"`
	Output      *SchemaRef   `json:"output"`
	Implemented bool         `json:"implemented"`
	At          Location     `json:"at"`
}

// TrpcRouter is one `defineTrpcRouter(Api, contract)` chain.
type TrpcRouter struct {
	Namespace  Scalar          `json:"namespace"`
	ContractAt Location        `json:"contractAt"`
	Procedures []TrpcProcedure `json:"procedures"`
	At         Location        `json:"at"`
}

// Socket is a websocket, rawsocket or rawhttp protocol declaration.
type Socket struct {
	Protocol string   `json:"protocol"`
	Paths    []Scalar `json:"paths"`
	Prefixes []Scalar `json:"prefixes"`
	At       Location `json:"at"`
}

// Schedule is a process manager's `.schedule({ everyMs })`.
type Schedule struct {
	EveryMs Scalar `json:"everyMs"`
	Source  string `json:"source"`
}

// ProcessManager is one `.withProcessManager(...)` of a pipeline.
type ProcessManager struct {
	Name     Scalar    `json:"name"`
	Schedule *Schedule `json:"schedule"`
	Intents  []string  `json:"intents"`
	Outbox   bool      `json:"outbox"`
	Applier  string    `json:"applier"`
	Read     bool      `json:"read"`
	Gated    bool      `json:"gated"`
	At       Location  `json:"at"`
}

// Subscriber is a peer or event subscriber of a pipeline.
type Subscriber struct {
	Kind      string   `json:"kind"`
	Name      Scalar   `json:"name"`
	EventType *Scalar  `json:"eventType"`
	Publisher string   `json:"publisher"`
	Gated     bool     `json:"gated"`
	At        Location `json:"at"`
}

// PipelineItem is a command, projection or other declared part of a pipeline.
type PipelineItem struct {
	Kind  string   `json:"kind"`
	Name  Scalar   `json:"name"`
	Gated bool     `json:"gated"`
	At    Location `json:"at"`
}

// Pipeline is one `definePipeline(...)` chain; Split is the early-build condition.
type Pipeline struct {
	Name            Scalar           `json:"name"`
	Aggregate       Scalar           `json:"aggregate"`
	Events          []string         `json:"events"`
	Commands        []PipelineItem   `json:"commands"`
	ProcessManagers []ProcessManager `json:"processManagers"`
	Subscribers     []Subscriber     `json:"subscribers"`
	Others          []PipelineItem   `json:"others"`
	Split           string           `json:"split"`
	SplitAt         *Location        `json:"splitAt"`
	At              Location         `json:"at"`
}

// Task is a task class named by `.withTasks(...)`.
type Task struct {
	Name      Scalar   `json:"name"`
	ClassName string   `json:"className"`
	At        Location `json:"at"`
}

// Installation is the module's `defineProcessModule(...)` chain.
type Installation struct {
	Text  string   `json:"text"`
	At    Location `json:"at"`
	Tasks []Task   `json:"tasks"`
}

// ProcessFacts is a process half as the extractor reads it.
type ProcessFacts struct {
	Installation *Installation `json:"installation"`
	Rest         []RestFamily  `json:"rest"`
	Trpc         []TrpcRouter  `json:"trpc"`
	Sockets      []Socket      `json:"sockets"`
	Pipelines    []Pipeline    `json:"pipelines"`
}

// MountedRoute is one entry of the api's route registry after a describe-only mount.
type MountedRoute struct {
	Method        string `json:"method"`
	Path          string `json:"path"`
	Family        string `json:"family"`
	CanonicalPath string `json:"canonicalPath"`
}

// Mounted is the registry the extractor read, or why it could not.
type Mounted struct {
	Routes []MountedRoute `json:"routes"`
	Error  string         `json:"error"`
}

// processUnresolved counts the process-half values the extractor could not fold.
func processUnresolved(facts *ProcessFacts, counts map[string]int) {
	for index := range facts.Rest {
		counts["rest"] += restUnresolved(&facts.Rest[index])
	}
	trpcUnresolved(facts, counts)
	for index := range facts.Sockets {
		socket := &facts.Sockets[index]
		for _, value := range append(append([]Scalar(nil), socket.Paths...), socket.Prefixes...) {
			counts["socket"] += unresolved(value.Resolved)
		}
	}
	for index := range facts.Pipelines {
		pipelineUnresolved(&facts.Pipelines[index], counts)
	}
	if facts.Installation != nil {
		for index := range facts.Installation.Tasks {
			counts["task"] += unresolved(facts.Installation.Tasks[index].Name.Resolved)
		}
	}
}

func restUnresolved(family *RestFamily) int {
	count := unresolved(family.Namespace.Resolved) + unresolved(family.Version.Resolved)
	for index := range family.Routes {
		route := &family.Routes[index]
		count += unresolved(route.Path.Resolved) + unresolved(route.Operation.Resolved) + unresolved(route.Gate.Resolved)
	}
	return count
}

func pipelineUnresolved(pipeline *Pipeline, counts map[string]int) {
	counts["pipeline"] += unresolved(pipeline.Name.Resolved) + unresolved(pipeline.Aggregate.Resolved)
	for index := range pipeline.ProcessManagers {
		manager := &pipeline.ProcessManagers[index]
		counts["process manager"] += unresolved(manager.Name.Resolved) + unresolved(manager.Read)
		if manager.Schedule != nil {
			counts["schedule"] += unresolved(manager.Schedule.EveryMs.Resolved)
		}
	}
	for index := range pipeline.Subscribers {
		subscriber := &pipeline.Subscribers[index]
		peerRead := subscriber.Kind != "peer subscriber" || (subscriber.EventType != nil && subscriber.EventType.Resolved)
		counts["subscriber"] += unresolved(subscriber.Name.Resolved && peerRead)
	}
}

func trpcUnresolved(facts *ProcessFacts, counts map[string]int) {
	for index := range facts.Trpc {
		router := &facts.Trpc[index]
		counts["trpc"] += unresolved(router.Namespace.Resolved)
		for inner := range router.Procedures {
			procedure := &router.Procedures[inner]
			counts["trpc"] += unresolved(procedure.Gate.Resolved || !procedure.Implemented)
		}
	}
}
