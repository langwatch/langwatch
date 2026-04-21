package herr

import (
	"context"
	"testing"

	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type sampleStruct struct {
	Name  string `validate:"required"`
	Count int    `validate:"required,min=1"`
}

func TestFromValidationErrors_ConvertsToHerr(t *testing.T) {
	v := validator.New()
	err := v.Struct(sampleStruct{})

	var ve validator.ValidationErrors
	require.ErrorAs(t, err, &ve)

	e := FromValidationErrors(context.Background(), "test_invalid", ve, nil)

	assert.Equal(t, Code("test_invalid"), e.Code)

	violations, ok := e.Meta["violations"].([]Violation)
	require.True(t, ok)
	assert.Len(t, violations, 2)
	assert.Equal(t, "Name", violations[0].Field)
	assert.Equal(t, "required", violations[0].Rule)
	assert.Empty(t, violations[0].Tag)
}

func TestFromValidationErrors_UsesPathResolver(t *testing.T) {
	v := validator.New()
	err := v.Struct(sampleStruct{})

	var ve validator.ValidationErrors
	require.ErrorAs(t, err, &ve)

	resolver := func(field string) string {
		return "MY_PREFIX_" + field
	}

	e := FromValidationErrors(context.Background(), "cfg_bad", ve, resolver)

	violations := e.Meta["violations"].([]Violation)
	assert.Equal(t, "MY_PREFIX_Name", violations[0].Tag)
	assert.Equal(t, "MY_PREFIX_Count", violations[1].Tag)
}

func TestFromValidationErrors_MessageFormatting(t *testing.T) {
	type sample struct {
		URL   string `validate:"required,url"`
		Level string `validate:"required,oneof=debug info warn"`
	}

	v := validator.New()
	err := v.Struct(sample{URL: "not-a-url", Level: "bad"})

	var ve validator.ValidationErrors
	require.ErrorAs(t, err, &ve)

	e := FromValidationErrors(context.Background(), "test", ve, nil)
	violations := e.Meta["violations"].([]Violation)

	messages := map[string]string{}
	for _, viol := range violations {
		messages[viol.Field] = viol.Message
	}
	assert.Equal(t, "must be a valid URL", messages["URL"])
	assert.Equal(t, "must be one of: debug info warn", messages["Level"])
}
