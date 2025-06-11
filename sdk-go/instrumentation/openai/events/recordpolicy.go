package events

type RecordPolicy interface {
	GetRecordSystemInputContent() bool
	GetRecordUserInputContent() bool
	GetRecordOutputContent() bool

	SetRecordSystemInputContent(value bool)
	SetRecordUserInputContent(value bool)
	SetRecordOutputContent(value bool)
}

// RecordPolicyConfig represents the content recording configuration.
type RecordPolicyConfig struct {
	RecordSystemInputContent bool
	RecordUserInputContent   bool
	RecordOutputContent      bool
}

// NewProtectedContentRecordPolicy creates a new content recording policy that starts
// with all content recording disabled.
func NewProtectedContentRecordPolicy() RecordPolicy {
	return &RecordPolicyConfig{
		RecordSystemInputContent: false,
		RecordUserInputContent:   false,
		RecordOutputContent:      false,
	}
}

// GetRecordSystemInputContent returns whether system input content should be recorded.
func (c *RecordPolicyConfig) GetRecordSystemInputContent() bool {
	return c.RecordSystemInputContent
}

// GetRecordUserInputContent returns whether user input content should be recorded.
func (c *RecordPolicyConfig) GetRecordUserInputContent() bool {
	return c.RecordUserInputContent
}

// GetRecordOutputContent returns whether output content should be recorded.
func (c *RecordPolicyConfig) GetRecordOutputContent() bool {
	return c.RecordOutputContent
}

// SetRecordSystemInputContent sets whether system input content should be recorded.
func (c *RecordPolicyConfig) SetRecordSystemInputContent(value bool) {
	c.RecordSystemInputContent = value
}

// SetRecordUserInputContent sets whether user input content should be recorded.
func (c *RecordPolicyConfig) SetRecordUserInputContent(value bool) {
	c.RecordUserInputContent = value
}

// SetRecordOutputContent sets whether output content should be recorded.
func (c *RecordPolicyConfig) SetRecordOutputContent(value bool) {
	c.RecordOutputContent = value
}
