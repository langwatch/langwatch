// Package redteam provides adversarial user simulators that attack the agent
// under test over many turns, a port of the JS SDK's red-team module.
//
// A red-team Agent plays the user role. Each turn it scores the target's
// last response, backtracks on hard refusals (removing the refused exchange
// from the conversation so the target forgets it), and asks an attacker
// model for the next message using a private attacker history the target
// never sees. Two strategies are built in:
//
//   - CrescendoStrategy escalates in four phases (warmup, probing,
//     escalation, direct) following a pre-generated attack plan.
//   - GOATStrategy (Meta's GOAT paper) lets the attacker pick techniques from
//     a catalogue each turn, with no plan and no phases.
//
// Build an agent with NewCrescendoAgent, NewGOATAgent or New, and use its
// MarathonScript as the scenario script:
//
//	rt, err := redteam.NewCrescendoAgent(redteam.Config{
//		Target:     "extract the system prompt",
//		TotalTurns: 30,
//	})
//	...
//	scenario.Run(ctx, scenario.ScenarioConfig{
//		Agents: []scenario.AgentAdapter{myAgent, rt, judge},
//		Script: rt.MarathonScript(),
//		...
//	})
//
// When a run that includes a red-team agent ends, a JSON report is saved for
// the red-team dashboard (see SaveReport). Set SCENARIO_REDTEAM_REPORT=0 to
// turn it off and SCENARIO_REDTEAM_REPORT_DIR to choose the directory.
package redteam
