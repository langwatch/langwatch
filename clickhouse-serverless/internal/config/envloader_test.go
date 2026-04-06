package config

import (
	"testing"
)

type testStruct struct {
	Str     string  `env:"TEST_STR" default:"hello"`
	Bool    bool    `env:"TEST_BOOL" default:"true"`
	Int     int     `env:"TEST_INT" default:"42"`
	Int64   int64   `env:"TEST_INT64" default:"999"`
	Float   float64 `env:"TEST_FLOAT" default:"3.14"`
	BoolPtr *bool   `env:"TEST_BOOLPTR"`
	NoTag   string
}

func TestLoadEnv_Defaults(t *testing.T) {
	s := &testStruct{}
	if err := loadEnv(s); err != nil {
		t.Fatalf("loadEnv error: %v", err)
	}
	if s.Str != "hello" {
		t.Errorf("Str = %q, want %q", s.Str, "hello")
	}
	if s.Bool != true {
		t.Errorf("Bool = %v, want true", s.Bool)
	}
	if s.Int != 42 {
		t.Errorf("Int = %d, want 42", s.Int)
	}
	if s.Int64 != 999 {
		t.Errorf("Int64 = %d, want 999", s.Int64)
	}
	if s.Float != 3.14 {
		t.Errorf("Float = %f, want 3.14", s.Float)
	}
	if s.BoolPtr != nil {
		t.Errorf("BoolPtr = %v, want nil (no env or default)", s.BoolPtr)
	}
}

func TestLoadEnv_EnvOverridesDefault(t *testing.T) {
	t.Setenv("TEST_STR", "world")
	t.Setenv("TEST_BOOL", "false")
	t.Setenv("TEST_INT", "7")
	t.Setenv("TEST_INT64", "123456")
	t.Setenv("TEST_FLOAT", "2.72")
	t.Setenv("TEST_BOOLPTR", "true")

	s := &testStruct{}
	if err := loadEnv(s); err != nil {
		t.Fatalf("loadEnv error: %v", err)
	}
	if s.Str != "world" {
		t.Errorf("Str = %q, want %q", s.Str, "world")
	}
	if s.Bool != false {
		t.Errorf("Bool = %v, want false", s.Bool)
	}
	if s.Int != 7 {
		t.Errorf("Int = %d, want 7", s.Int)
	}
	if s.Int64 != 123456 {
		t.Errorf("Int64 = %d, want 123456", s.Int64)
	}
	if s.Float != 2.72 {
		t.Errorf("Float = %f, want 2.72", s.Float)
	}
	if s.BoolPtr == nil || *s.BoolPtr != true {
		t.Errorf("BoolPtr = %v, want *true", s.BoolPtr)
	}
}

func TestLoadEnv_InvalidInt(t *testing.T) {
	t.Setenv("TEST_INT", "not-a-number")
	s := &testStruct{}
	err := loadEnv(s)
	if err == nil {
		t.Fatal("expected error for invalid int")
	}
}

func TestLoadEnv_InvalidBool(t *testing.T) {
	t.Setenv("TEST_BOOL", "maybe")
	s := &testStruct{}
	err := loadEnv(s)
	if err == nil {
		t.Fatal("expected error for invalid bool")
	}
}

func TestLoadEnv_NoTagFieldIgnored(t *testing.T) {
	s := &testStruct{NoTag: "original"}
	if err := loadEnv(s); err != nil {
		t.Fatalf("loadEnv error: %v", err)
	}
	if s.NoTag != "original" {
		t.Errorf("NoTag was modified: %q", s.NoTag)
	}
}
