import { useColorMode } from "~/components/ui/color-mode";
import { LangWatchQLEditor as PackageEditor } from "@langwatch/analytics-web";
import type { LangWatchQLEditorProps } from "@langwatch/analytics-web";

export type { LangWatchQLEditorProps } from "@langwatch/analytics-web";

export function LangWatchQLEditor(props: LangWatchQLEditorProps) {
  const { colorMode } = useColorMode();
  return <PackageEditor {...props} theme={colorMode === "dark" ? "vs-dark" : "vs"} />;
}
