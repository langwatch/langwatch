//go:build !darwin

package system

// darwinMemSize is never reached off darwin; TotalMemory switches on GOOS first.
func darwinMemSize() uint64 { return 0 }
