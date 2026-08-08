package domain

import (
	"strconv"
	"strings"
)

// Parsing the machine's own memory tools lives here rather than in the adapter
// so it is testable without a Mac — and because the one thing that is easy to
// get wrong is arithmetic, not shelling out.

// ParseVMStat pulls the page size and the compressor's OCCUPIED page count out
// of `vm_stat` output.
//
// Two traps, both silent. The page size is 16384 on Apple silicon and 4096 on
// Intel, and it is printed in the header rather than assumed — hard-coding 4096
// understates the compressor by four times on the machines this governor exists
// for, and the level then never fires. And "Pages occupied by compressor" is a
// different number from "Pages stored in compressor": on the machine that
// motivated ADR-090 they read 128k and 679k, so reading the wrong line
// overstates by five times.
func ParseVMStat(out string) (pageSizeBytes, occupiedPages uint64, ok bool) {
	for line := range strings.SplitSeq(out, "\n") {
		if n, found := vmStatPageSize(line); found {
			pageSizeBytes = n
			continue
		}
		if n, found := vmStatOccupiedPages(line); found {
			occupiedPages = n
		}
	}
	return pageSizeBytes, occupiedPages, pageSizeBytes > 0
}

// vmStatPageSize reads the header: "Mach Virtual Memory Statistics: (page size
// of 16384 bytes)".
func vmStatPageSize(line string) (uint64, bool) {
	_, rest, found := strings.Cut(line, "page size of")
	if !found {
		return 0, false
	}
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return 0, false
	}
	n, err := strconv.ParseUint(fields[0], 10, 64)
	return n, err == nil
}

// vmStatOccupiedPages reads "Pages occupied by compressor:            127999."
// — deliberately not "Pages stored in compressor", which is a much larger
// number describing how much has been squeezed rather than what it costs.
func vmStatOccupiedPages(line string) (uint64, bool) {
	_, rest, found := strings.Cut(line, "Pages occupied by compressor:")
	if !found {
		return 0, false
	}
	n, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(rest), "."), 10, 64)
	return n, err == nil
}

// ParseSwapUsage pulls used and total bytes out of `sysctl -n vm.swapusage`:
//
//	total = 4096.00M  used = 3210.75M  free = 885.25M  (encrypted)
//
// Values carry a unit suffix and a decimal point, so they are parsed as floats
// and scaled rather than read as integers.
func ParseSwapUsage(out string) (usedBytes, totalBytes uint64, ok bool) {
	fields := strings.Fields(out)
	for i, f := range fields {
		if i+2 >= len(fields) || fields[i+1] != "=" {
			continue
		}
		value, parsed := parseSizeWithSuffix(fields[i+2])
		if !parsed {
			continue
		}
		switch strings.TrimSuffix(f, ":") {
		case "total":
			totalBytes = value
			ok = true
		case "used":
			usedBytes = value
		}
	}
	return usedBytes, totalBytes, ok
}

// parseSizeWithSuffix reads "3210.75M" as bytes. A suffix this does not know is
// a parse failure rather than a guess — a swap figure silently off by 1024x
// would pin the governor at red forever.
func parseSizeWithSuffix(s string) (uint64, bool) {
	if s == "" {
		return 0, false
	}
	multiplier := uint64(1)
	switch s[len(s)-1] {
	case 'K':
		multiplier = 1 << 10
	case 'M':
		multiplier = 1 << 20
	case 'G':
		multiplier = 1 << 30
	case 'T':
		multiplier = 1 << 40
	default:
		if s[len(s)-1] < '0' || s[len(s)-1] > '9' {
			return 0, false
		}
	}
	if multiplier > 1 {
		s = s[:len(s)-1]
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || n < 0 {
		return 0, false
	}
	return uint64(n * float64(multiplier)), true
}
