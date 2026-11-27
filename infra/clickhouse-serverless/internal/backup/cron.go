package backup

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Schedule is a five-field cron expression (minute hour day-of-month month
// day-of-week), evaluated in UTC like a CronJob without a time zone. Fields
// take *, a, a-b, lists and /step. With both day fields restricted, either
// matching is enough, as in cron.
type Schedule struct {
	expr                         string
	minute, hour, dom, month, dw uint64 // bit sets
	domStar, dowStar             bool
}

// ParseSchedule parses expr.
func ParseSchedule(expr string) (*Schedule, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return nil, fmt.Errorf("schedule %q: want five fields (minute hour day-of-month month day-of-week)", expr)
	}
	s := &Schedule{expr: expr}
	var err error
	bounds := []struct {
		dst      *uint64
		lo, hi   int
		name     string
		wildcard *bool
	}{
		{&s.minute, 0, 59, "minute", nil},
		{&s.hour, 0, 23, "hour", nil},
		{&s.dom, 1, 31, "day-of-month", &s.domStar},
		{&s.month, 1, 12, "month", nil},
		{&s.dw, 0, 7, "day-of-week", &s.dowStar},
	}
	for i, b := range bounds {
		if *b.dst, err = parseField(fields[i], b.lo, b.hi); err != nil {
			return nil, fmt.Errorf("schedule %q, %s: %w", expr, b.name, err)
		}
		if b.wildcard != nil {
			*b.wildcard = strings.HasPrefix(fields[i], "*")
		}
	}
	if s.dw&(1<<7) != 0 { // 7 is Sunday too
		s.dw |= 1
	}
	if _, ok := s.Next(time.Unix(0, 0)); !ok {
		return nil, fmt.Errorf("schedule %q never fires", expr)
	}
	return s, nil
}

func (s *Schedule) String() string { return s.expr }

func parseField(field string, lo, hi int) (uint64, error) {
	var set uint64
	for _, part := range strings.Split(field, ",") {
		rng, stepText, hasStep := strings.Cut(part, "/")
		step := 1
		if hasStep {
			n, err := strconv.Atoi(stepText)
			if err != nil || n < 1 {
				return 0, fmt.Errorf("bad step %q", stepText)
			}
			step = n
		}
		start, end := lo, hi
		switch {
		case rng == "*":
		case strings.Contains(rng, "-"):
			a, b, _ := strings.Cut(rng, "-")
			var err error
			if start, err = atoiIn(a, lo, hi); err != nil {
				return 0, err
			}
			if end, err = atoiIn(b, lo, hi); err != nil {
				return 0, err
			}
			if end < start {
				return 0, fmt.Errorf("range %q runs backwards", rng)
			}
		default:
			n, err := atoiIn(rng, lo, hi)
			if err != nil {
				return 0, err
			}
			start, end = n, n
			if hasStep {
				end = hi
			}
		}
		for v := start; v <= end; v += step {
			set |= 1 << v
		}
	}
	return set, nil
}

func atoiIn(s string, lo, hi int) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%q is not a number from %d to %d", s, lo, hi)
	}
	return n, nil
}

func (s *Schedule) dayMatches(t time.Time) bool {
	dom := s.dom&(1<<t.Day()) != 0
	dow := s.dw&(1<<int(t.Weekday())) != 0
	if s.domStar || s.dowStar {
		return dom && dow
	}
	return dom || dow
}

// searchYears bounds the walk: Feb 29 on a given weekday recurs within 28.
const searchYears = 29

// Next is the first firing strictly after t.
func (s *Schedule) Next(t time.Time) (time.Time, bool) {
	c := t.UTC().Truncate(time.Minute).Add(time.Minute)
	limit := c.AddDate(searchYears, 0, 0)
	for c.Before(limit) {
		switch {
		case s.month&(1<<int(c.Month())) == 0:
			c = time.Date(c.Year(), c.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		case !s.dayMatches(c):
			c = time.Date(c.Year(), c.Month(), c.Day()+1, 0, 0, 0, 0, time.UTC)
		case s.hour&(1<<c.Hour()) == 0:
			c = c.Truncate(time.Hour).Add(time.Hour)
		case s.minute&(1<<c.Minute()) == 0:
			c = c.Add(time.Minute)
		default:
			return c, true
		}
	}
	return time.Time{}, false
}

// Prev is the latest firing at or before t.
func (s *Schedule) Prev(t time.Time) (time.Time, bool) {
	c := t.UTC().Truncate(time.Minute)
	limit := c.AddDate(-searchYears, 0, 0)
	for c.After(limit) {
		switch {
		case s.month&(1<<int(c.Month())) == 0:
			c = time.Date(c.Year(), c.Month(), 1, 0, 0, 0, 0, time.UTC).Add(-time.Minute)
		case !s.dayMatches(c):
			c = time.Date(c.Year(), c.Month(), c.Day(), 0, 0, 0, 0, time.UTC).Add(-time.Minute)
		case s.hour&(1<<c.Hour()) == 0:
			c = c.Truncate(time.Hour).Add(-time.Minute)
		case s.minute&(1<<c.Minute()) == 0:
			c = c.Add(-time.Minute)
		default:
			return c, true
		}
	}
	return time.Time{}, false
}
