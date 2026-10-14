package rules

// HasCompletionModel reports whether the tenant's env names a chat model. TS
// sends an X_LITELLM_* block, model included, for every configured provider
// and none for an unconfigured one; per-provider key checks are the LLM
// channel's.
func HasCompletionModel(env map[string]string) bool {
	return env["X_LITELLM_model"] != ""
}
