package stacktrace

import (
	"fmt"
	"runtime"
	"strings"
)

// Frame represents a single stack frame.
type Frame struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Function string `json:"function"`
}

// GetCallerFrames returns stack frames starting at skip levels above the caller.
// 0 = GetCallerFrames itself, 1 = caller of GetCallerFrames, etc.
func GetCallerFrames(skip int) []Frame {
	stack := make([]uintptr, 100)
	length := runtime.Callers(skip+1, stack)
	stack = stack[:length]

	framesIter := runtime.CallersFrames(stack)
	frames := make([]Frame, 0, length)

	for {
		frame, more := framesIter.Next()
		frames = append(frames, Frame{
			File:     frame.File,
			Line:     frame.Line,
			Function: frame.Function,
		})
		if !more {
			break
		}
	}

	return frames
}

func (f Frame) String() string {
	return fmt.Sprintf("%s\n\t%s:%d", f.Function, f.File, f.Line)
}

// FormatFrames pretty-prints a slice of frames.
func FormatFrames(frames []Frame) string {
	var sb strings.Builder
	for _, frame := range frames {
		sb.WriteString(frame.String())
		sb.WriteString("\n")
	}
	return sb.String()
}

// MergeStacks combines a root stack with a wrapped stack, deduplicating shared frames.
func MergeStacks(root []Frame, wrapped []Frame) []Frame {
	if len(wrapped) == 0 {
		return root
	}
	if len(wrapped) == 1 {
		return append(root, wrapped[0])
	}

	for idx, f := range root {
		if f == wrapped[0] {
			return root
		}
		if f == wrapped[1] {
			return insert(root, wrapped[0], idx)
		}
	}
	return root
}

func insert(s []Frame, u Frame, at int) []Frame {
	return append(s[:at], append([]Frame{u}, s[at:]...)...)
}
