package rules

import (
	"regexp"
	"strings"
)

// Basic ports langevals_langevals/basic.py: every rule must pass, and the
// first failing rule names itself in the details. A rule pattern RE2 cannot
// compile (lookaround, backreferences) is an error, as Python's re.error was.
// ponytail: \d, \w, \s and \b are ASCII in RE2 and Unicode in Python's re.
func Basic(settings CustomBasicSettings, input, output *string) (passed bool, details string, err error) {
	if len(settings.Rules) == 0 {
		return false, "No rules were defined", nil
	}
	for _, rule := range settings.Rules {
		field := output
		if rule.Field == "input" {
			field = input
		}
		ok, err := checkRule(rule, derefOr(field, ""))
		if err != nil {
			return false, "", err
		}
		if !ok {
			return false, "Rule " + rule.Rule + ` "` + rule.Value + `" failed for ` + rule.Field + ` "` + derefOr(field, "None") + `"`, nil
		}
	}
	return true, "", nil
}

func checkRule(rule CustomBasicRule, text string) (bool, error) {
	switch rule.Rule {
	case "contains":
		return strings.Contains(text, rule.Value), nil
	case "not_contains":
		return !strings.Contains(text, rule.Value), nil
	case "matches_regex", "not_matches_regex":
		pattern, err := regexp.Compile("(?m)" + rule.Value)
		if err != nil {
			return false, err
		}
		return pattern.MatchString(text) == (rule.Rule == "matches_regex"), nil
	default:
		return false, nil
	}
}

// derefOr is Python's `value or fallback` for an optional string field.
func derefOr(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}
