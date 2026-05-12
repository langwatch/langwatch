package config

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
)

type testConfig struct {
	Server struct {
		Addr string `env:"ADDR" validate:"required"`
		Port int    `env:"PORT" validate:"required,min=1"`
	} `env:"SERVER"`
	Secret string `env:"SECRET" validate:"required"`
}

func TestValidate_ReturnsNilWhenValid(t *testing.T) {
	cfg := testConfig{Secret: "abc"}
	cfg.Server.Addr = ":8080"
	cfg.Server.Port = 8080

	err := Validate(context.Background(), cfg)
	assert.NoError(t, err)
}

func TestValidate_ReturnsHerrWithViolations(t *testing.T) {
	cfg := testConfig{} // all zero values

	err := Validate(context.Background(), cfg)
	require.Error(t, err)

	var e herr.E
	require.ErrorAs(t, err, &e)
	assert.Equal(t, ConfigInvalid, e.Code)

	violations, ok := e.Meta["violations"].([]herr.Violation)
	require.True(t, ok)
	assert.Len(t, violations, 3)

	envs := make(map[string]string)
	for _, v := range violations {
		envs[v.Field] = v.Tag
	}
	assert.Equal(t, "SERVER_ADDR", envs["Server.Addr"])
	assert.Equal(t, "SERVER_PORT", envs["Server.Port"])
	assert.Equal(t, "SECRET", envs["Secret"])
}

func TestValidate_ResolvesNestedEnvPrefix(t *testing.T) {
	type inner struct {
		Value string `env:"VALUE" validate:"required"`
	}
	type outer struct {
		Inner inner `env:"INNER"`
	}
	type cfg struct {
		Outer outer `env:"OUTER"`
	}

	err := Validate(context.Background(), cfg{})
	require.Error(t, err)

	var e herr.E
	require.ErrorAs(t, err, &e)

	violations := e.Meta["violations"].([]herr.Violation)
	require.Len(t, violations, 1)
	assert.Equal(t, "Outer.Inner.Value", violations[0].Field)
	assert.Equal(t, "OUTER_INNER_VALUE", violations[0].Tag)
}
