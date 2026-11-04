import { parseAllDocuments } from "yaml";

/** Templates, comments and ellipses make a sample illustrative; only plain data is parsed. */
const NOT_PLAIN_DATA = /\{\{|\{%|\/\/|\/\*|^\s*#|\.\.\.|…|<[\w .|/-]+>/m;
/** A Python line that opens a block: its body must be indented further. */
const PYTHON_OPENER =
  /^(\s*)(?:async\s+)?(?:def|class|if|elif|else|for|while|try|except|finally|with|match|case)\b[^#]*:\s*(?:#.*)?$/;

function jsonBroken({ text }: { text: string }) {
  if (NOT_PLAIN_DATA.test(text)) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

function yamlBroken({ text }: { text: string }) {
  if (/\{\{|\{%/.test(text)) return false;
  return parseAllDocuments(text).some((document) =>
    "errors" in document ? document.errors.length > 0 : false,
  );
}

const indentOf = ({ line }: { line: string }) => line.length - line.trimStart().length;

/** A block opener whose next code line is not indented under it. */
function pythonBroken({ lines }: { lines: string[] }) {
  const code = lines.filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  return code.some((line, index) => {
    const opener = PYTHON_OPENER.exec(line)?.[1];
    const next = code[index + 1];
    if (opener === undefined || next === undefined) return false;
    return indentOf({ line: next }) <= opener.length;
  });
}

/** Whether a sample cannot be pasted because it does not parse in its own language. */
export function unparseable({ lang, lines }: { lang: string; lines: string[] }) {
  const text = lines.join("\n");
  if (lang === "json") return jsonBroken({ text });
  if (lang === "yaml" || lang === "yml") return yamlBroken({ text });
  if (lang === "python" || lang === "py") return pythonBroken({ lines });
  return false;
}
