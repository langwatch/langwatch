package cell

import (
	"strings"
	"testing"
	"time"
)

func refusedAndFixed() damageState {
	planted := `CREATE INDEX "` + damageIndex + `" ON mydb."AuditLog" USING btree ("createdAt")`
	row := damageRefusal{Kind: damageKindRow, Step: "prisma:" + damageFolder, ReadyzWhile: 503, PrismaRowsWhile: 346, PrismaRowsBefore: 346, FinishedRowsBefore: 345, FinishedRowsWhile: 345,
		Text:      "Prisma migration " + damageFolder + " failed ... in packages/prisma-client with DATABASE_URL set, run \"prisma migrate resolve --rolled-back " + damageFolder + "\"",
		StatusOut: "failed prisma:" + damageFolder, RerunHow: "on its own", IndexWhile: planted}
	index := damageRefusal{Kind: damageKindIndex, Step: "run:x", Code: "prebuilt_index_differs", ReadyzWhile: 503, PrismaRowsWhile: 347, PrismaRowsBefore: 347, FinishedRowsBefore: 346, FinishedRowsWhile: 346,
		Text: "prebuilt_index_differs: index \"" + damageIndex + "\" on \"AuditLog\" ... It should be: x. It is: y. Drop or rename it; nothing drops it for you.", StatusOut: damageIndex, RerunHow: "on its own", IndexWhile: planted}
	return damageState{plantedRows: 346, finishedRows: 345, plantedIndex: planted, refusals: []damageRefusal{row, index},
		finalIndex: damageWantIndex, finalFolder: "1 applied, 0 failed"}
}

func TestJudgeDamagePassesWhenEachRefusalIsFixedAndConverges(t *testing.T) {
	for _, v := range judgeDamage(refusedAndFixed(), true) {
		if v.Result != "pass" {
			t.Errorf("%s: %s %s", v.ID, v.Result, v.Detail)
		}
	}
}

func TestJudgeDamageFailsEachWayOnItsOwn(t *testing.T) {
	cases := map[string]struct {
		id    string
		spoil func(*damageState)
	}{
		"index accepted silently": {"D2", func(d *damageState) {
			d.refusals = d.refusals[:1]
			d.finalIndex = `CREATE INDEX "x" ON mydb."AuditLog" USING btree ("createdAt")`
		}},
		"refusal names no fix":       {"D1", func(d *damageState) { d.refusals[0].Text = "something failed" }},
		"served while refused":       {"D1", func(d *damageState) { d.refusals[0].ReadyzWhile = 200 }},
		"applied more while refused": {"D1", func(d *damageState) { d.refusals[0].FinishedRowsWhile = 350 }},
		"row deleted":                {"D1", func(d *damageState) { d.refusals[0].PrismaRowsWhile = 300 }},
		"fix failed":                 {"D1", func(d *damageState) { d.refusals[0].FixErr = "P3008" }},
		"index dropped for them":     {"D2", func(d *damageState) { d.refusals[1].IndexWhile = "(none)" }},
		"folders applied first":      {"D2", func(d *damageState) { d.refusals[1].FinishedRowsWhile = 360 }},
		"index refusal names no fix": {"D2", func(d *damageState) { d.refusals[1].Text = "prebuilt_index_differs: " + damageIndex }},
		"folder left failed":         {"D1", func(d *damageState) { d.finalFolder = "0 applied, 1 failed" }},
		"status silent":              {"D3", func(d *damageState) { d.refusals[0].StatusOut = "all good" }},
	}
	for name, c := range cases {
		dmg := refusedAndFixed()
		dmg.refusals = append([]damageRefusal(nil), dmg.refusals...)
		c.spoil(&dmg)
		for _, v := range judgeDamage(dmg, true) {
			if v.ID == c.id && v.Result != "fail" {
				t.Errorf("%s: %s passed: %s", name, v.ID, v.Detail)
			}
		}
	}
	for _, v := range judgeDamage(refusedAndFixed(), false) {
		if v.ID != "D3" && v.Result != "fail" {
			t.Errorf("not ready: %s passed", v.ID)
		}
	}
}

func TestDamageKindReadsTheRefusalText(t *testing.T) {
	if damageKind("Prisma migration "+damageFolder+" failed") != damageKindRow || damageKind(`relation "`+damageIndex+`"`) != damageKindIndex || damageKind("other") != "" {
		t.Fatal("damageKind misread a refusal")
	}
	if !strings.Contains(damagePlantSQL, `"finished_at" = NULL`) || !strings.Contains(damagePlantSQL, `CREATE INDEX "`+damageIndex+`" ON mydb."AuditLog" ("createdAt")`) {
		t.Fatal("plant SQL lost a kind of damage")
	}
}

func TestRefusalLineAcceptsOnlyTheRefusalBeforeReady(t *testing.T) {
	origin := time.Date(2026, 10, 11, 21, 50, 0, 0, time.UTC)
	line := `{"level":"error","time":"2026-10-11T21:52:35.201Z","msg":"langwatch-api (api): the upgrade failed; this api holds the door with the upgrade console"}`
	if !refusalLine(line, 300_000, origin) || refusalLine(line, 60_000, origin) || refusalLine(`{"level":"error","time":"2026-10-11T21:52:35.201Z","msg":"boom"}`, 300_000, origin) {
		t.Fatal("refusalLine misjudged a line")
	}
}
