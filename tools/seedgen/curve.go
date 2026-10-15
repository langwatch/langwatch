package seedgen

import (
	"math"
	"time"
)

// Incident is a named day that bends an organization's curve (design §6.1).
type Incident struct {
	Name string
	Day  int
}

// Curve is one organization's traffic shape over [anchor − days, anchor): diurnal × weekday ×
// growth × incidents, all drawn from the seed.
type Curve struct {
	Growth    float64
	Incidents []Incident
	days      int
}

func newCurve(draws Draws, org int64, days int) Curve {
	return Curve{
		Growth: 1.5 * draws.Float("curve", org, "growth"),
		Incidents: []Incident{
			{Name: "outage", Day: int(draws.Uint64("curve", org, "outage") % uint64(days))},
			{Name: "model-rollout", Day: int(draws.Uint64("curve", org, "model-rollout") % uint64(days))},
			{Name: "prompt-regression", Day: int(draws.Uint64("curve", org, "prompt-regression") % uint64(days))},
		},
		days: days,
	}
}

// Weight is the relative volume of the hour starting at at, day days into the window.
func (c Curve) Weight(at time.Time, day int) float64 {
	hour := at.UTC().Hour()
	weight := 0.25 + 0.75*math.Max(0, math.Sin(math.Pi*float64(hour-6)/16))
	if weekday := at.UTC().Weekday(); weekday == time.Saturday || weekday == time.Sunday {
		weight *= 0.45
	}
	weight *= 1 + c.Growth*float64(day)/float64(c.days)
	for _, incident := range c.Incidents {
		if incident.Day != day {
			continue
		}
		switch {
		case incident.Name == "outage" && hour >= 10 && hour < 14:
			weight *= 0.05
		case incident.Name == "model-rollout":
			weight *= 1.6
		case incident.Name == "prompt-regression":
			weight *= 1.2
		}
	}
	return weight
}
