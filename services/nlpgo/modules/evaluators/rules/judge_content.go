package rules

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// JudgeFields are the entry fields a langevals judge shows its model; a nil
// field is Python's None.
type JudgeFields struct {
	Input          *string
	Output         *string
	ExpectedOutput *string
	Contexts       []string
}

var judgeMarkdownImage = regexp.MustCompile(`(?s)^!\[([^\]]*)\]\((.+)\)$`)

// DetectImage is image_support.detect_image: the URL or data URI when the
// whole value is one image reference, else "".
func DetectImage(value string) string {
	stripped := strings.TrimSpace(value)
	if stripped == "" {
		return ""
	}
	if isJudgeImageReference(stripped) {
		return stripped
	}
	if match := judgeMarkdownImage.FindStringSubmatch(stripped); match != nil {
		if reference := strings.TrimSpace(match[2]); isJudgeImageReference(reference) {
			return reference
		}
	}
	return ""
}

func isJudgeImageReference(value string) bool {
	if strings.HasPrefix(value, "data:image/") {
		return true
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	path := strings.ToLower(parsed.Path)
	for _, extension := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"} {
		if strings.HasSuffix(path, extension) {
			return true
		}
	}
	return false
}

type judgeLabeledField struct {
	label, value, image string
}

// JudgeUserContent is image_support.build_content_parts: the "# Input ... #
// Task" text, or OpenAI content parts once any field is an image.
func JudgeUserContent(fields JudgeFields, task string) any {
	var named []judgeLabeledField
	hasImage := false
	for _, field := range []struct {
		label string
		value *string
	}{{"Input", fields.Input}, {"Output", fields.Output}, {"Expected Output", fields.ExpectedOutput}} {
		if field.value == nil || *field.value == "" {
			continue
		}
		image := DetectImage(*field.value)
		hasImage = hasImage || image != ""
		named = append(named, judgeLabeledField{field.label, *field.value, image})
	}
	var contexts []judgeLabeledField
	for _, context := range fields.Contexts {
		if strings.TrimSpace(context) == "" {
			continue
		}
		image := DetectImage(context)
		hasImage = hasImage || image != ""
		contexts = append(contexts, judgeLabeledField{"", context, image})
	}
	if !hasImage {
		return judgeTextContent(named, contexts, task)
	}
	return judgeContentParts(named, contexts, task)
}

func judgeTextContent(named, contexts []judgeLabeledField, task string) string {
	var content strings.Builder
	for _, field := range named {
		content.WriteString("# " + field.label + "\n" + field.value + "\n\n")
	}
	if len(contexts) > 0 {
		numbered := make([]string, len(contexts))
		for i, context := range contexts {
			numbered[i] = strconv.Itoa(i+1) + ". " + context.value
		}
		content.WriteString("# Contexts\n" + strings.Join(numbered, "\n") + "\n\n")
	}
	content.WriteString("# Task\n" + task)
	return content.String()
}

func judgeContentParts(named, contexts []judgeLabeledField, task string) []map[string]any {
	var parts []map[string]any
	for _, field := range named {
		if field.image != "" {
			parts = append(parts, judgeTextPart("# "+field.label), judgeImagePart(field.image))
			continue
		}
		parts = append(parts, judgeTextPart("# "+field.label+"\n"+field.value))
	}
	parts = append(parts, judgeContextParts(contexts)...)
	return append(parts, judgeTextPart("# Task\n"+task))
}

// judgeContextParts numbers the text contexts under "# Contexts", flushed
// before each image context, which gets its own heading when none is pending.
func judgeContextParts(contexts []judgeLabeledField) []map[string]any {
	var parts []map[string]any
	var pending []string
	for i, context := range contexts {
		if context.image == "" {
			pending = append(pending, strconv.Itoa(i+1)+". "+context.value)
			continue
		}
		heading := "# Contexts"
		if len(pending) > 0 {
			heading += "\n" + strings.Join(pending, "\n")
			pending = nil
		}
		parts = append(parts, judgeTextPart(heading), judgeImagePart(context.image))
	}
	if len(pending) > 0 {
		parts = append(parts, judgeTextPart("# Contexts\n"+strings.Join(pending, "\n")))
	}
	return parts
}

func judgeTextPart(text string) map[string]any {
	return map[string]any{"type": "text", "text": text}
}

func judgeImagePart(reference string) map[string]any {
	return map[string]any{"type": "image_url", "image_url": map[string]any{"url": reference}}
}
