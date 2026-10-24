package contract

// EntityType is a PII entity type as Presidio names it, e.g. "EMAIL_ADDRESS".
type EntityType string

// PIIFinding is one detected PII span. Start and End are Unicode code point
// offsets into the analyzed text, as Presidio reports them.
type PIIFinding struct {
	EntityType EntityType `json:"entity_type"`
	Start      int        `json:"start"`
	End        int        `json:"end"`
	Score      float64    `json:"score"`
}
