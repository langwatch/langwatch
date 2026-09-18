function writeKey(obj) {
    Object.defineProperty(obj, "__proto__", { value: undefined, writable: true, enumerable: true, configurable: true });
}
export function parseXML(xml) {
    const state = new AwsXmlParser(xml);
    return state.parse();
}
class AwsXmlParser {
    x;
    i = 0;
    z;
    constructor(x) {
        this.x = x;
        this.x = x.replace(/\r\n?/g, "\n");
        this.z = this.x.length;
    }
    parse() {
        const p = this;
        const { z } = p;
        while (p.i < z) {
            p.trim();
            if (p.i >= z) {
                break;
            }
            if (p.isNext("<?")) {
                p.readTo("?>");
                p.trim();
            }
            else if (p.isNext("<!--")) {
                p.readTo("-->");
                p.trim();
            }
            else if (p.isNext("<!DOCTYPE", false)) {
                p.skipDoctype();
                p.trim();
            }
            else if (p.x[p.i] === "<") {
                const root = p.parseTag();
                return { [root.tag]: root.value };
            }
            else {
                throw new Error("@aws-sdk XML parse error: unexpected content.");
            }
        }
        throw new Error("@aws-sdk XML parse error: no root element.");
    }
    isNext(s, caseSensitive = true) {
        const p = this;
        if (caseSensitive) {
            return p.x.startsWith(s, p.i);
        }
        return p.x.toLowerCase().startsWith(s.toLowerCase(), p.i);
    }
    readTo(stop) {
        const p = this;
        const _i = p.x.indexOf(stop, p.i);
        if (_i === -1) {
            throw new Error(`@aws-sdk XML parse error: expected "${stop}" not found.`);
        }
        const result = p.x.slice(p.i, _i);
        p.i = _i + stop.length;
        return result;
    }
    trim() {
        const p = this;
        while (p.i < p.z && " \t\r\n".includes(p.x[p.i])) {
            ++p.i;
        }
    }
    readAttrValue() {
        const p = this;
        const quote = p.x[p.i];
        ++p.i;
        let value = "";
        while (p.i < p.z && p.x[p.i] !== quote) {
            value += p.x[p.i++];
        }
        ++p.i;
        return p.decodeEntities(value);
    }
    parseTag() {
        const p = this;
        ++p.i;
        let tag = "";
        while (p.i < p.z && !" \t\r\n>/".includes(p.x[p.i])) {
            tag += p.x[p.i++];
        }
        let hasAttrs = false;
        const attrs = {};
        while (p.i < p.z) {
            p.trim();
            if (">/".includes(p.x[p.i])) {
                break;
            }
            let name = "";
            while (p.i < p.z && !"= \t\r\n>/?".includes(p.x[p.i])) {
                name += p.x[p.i++];
            }
            p.trim();
            if (p.x[p.i] !== "=") {
                break;
            }
            ++p.i;
            p.trim();
            if (name === "__proto__") {
                writeKey(attrs);
            }
            attrs[name] = p.readAttrValue();
            hasAttrs = true;
        }
        if (p.i >= p.z) {
            throw new Error("@aws-sdk XML parse error: unexpected end of input.");
        }
        if (p.x[p.i] === "/") {
            ++p.i;
            if (p.i >= p.z || p.x[p.i] !== ">") {
                throw new Error("@aws-sdk XML parse error: expected > at the end of self-closing tag.");
            }
            ++p.i;
            return { tag, value: hasAttrs ? attrs : "" };
        }
        if (p.x[p.i] !== ">") {
            throw new Error("@aws-sdk XML parse error: expected > at the end of opening tag.");
        }
        ++p.i;
        const textParts = [];
        const childTags = [];
        let hasElementChild = false;
        while (p.i < p.z) {
            if (p.isNext("</")) {
                break;
            }
            if (p.x[p.i] === "<") {
                if (p.isNext("<!--")) {
                    p.readTo("-->");
                }
                else if (p.isNext("<![CDATA[")) {
                    p.i += 9;
                    textParts.push(p.readTo("]]>"));
                }
                else if (p.isNext("<?")) {
                    p.readTo("?>");
                }
                else {
                    hasElementChild = true;
                    childTags.push(p.parseTag());
                }
            }
            else {
                let text = "";
                while (p.i < p.z && p.x[p.i] !== "<") {
                    text += p.x[p.i++];
                }
                textParts.push(p.decodeEntities(text));
            }
        }
        if (!p.isNext("</")) {
            throw new Error(`@aws-sdk XML parse error: missing closing tag </${tag}>.`);
        }
        p.i += 2;
        const closeTag = p.readTo(">").trim();
        if (closeTag !== tag) {
            throw new Error(`@aws-sdk XML parse error: mismatched tags <${tag}> and </${closeTag}>.`);
        }
        if (!hasAttrs && textParts.length === 0 && !hasElementChild) {
            return { tag, value: "" };
        }
        if (!hasAttrs && !hasElementChild) {
            const text = textParts.length === 1 ? textParts[0] : textParts.join("");
            if (text.trim() === "" && text.includes("\n")) {
                return { tag, value: "" };
            }
            return { tag, value: text };
        }
        const obj = {};
        for (const text of textParts) {
            if (text.trim() === "" && text.includes("\n")) {
                continue;
            }
            obj["#text"] = "#text" in obj ? obj["#text"] + text : text;
        }
        for (const child of childTags) {
            if (child.tag === "__proto__") {
                writeKey(obj);
            }
            if (child.tag in obj) {
                if (Array.isArray(obj[child.tag])) {
                    obj[child.tag].push(child.value);
                }
                else {
                    obj[child.tag] = [obj[child.tag], child.value];
                }
            }
            else {
                obj[child.tag] = child.value;
            }
        }
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "__proto__") {
                writeKey(obj);
            }
            obj[k] = v;
        }
        return { tag, value: obj };
    }
    static ENTITIES = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
    };
    skipDoctype() {
        const p = this;
        p.i += 9;
        let depth = 0;
        while (p.i < p.z) {
            const c = p.x[p.i];
            if (c === "[") {
                ++depth;
            }
            else if (c === "]") {
                --depth;
            }
            else if (c === ">" && depth === 0) {
                ++p.i;
                return;
            }
            ++p.i;
        }
        throw new Error("@aws-sdk XML parse error: unclosed DOCTYPE.");
    }
    decodeEntities(s) {
        return s.replace(/&(?:#x([0-9a-fA-F]{1,6})|#(\d{1,7})|([a-zA-Z][a-zA-Z0-9]{0,30}));/g, (_, hex, dec, named) => {
            if (hex) {
                return String.fromCharCode(parseInt(hex, 16));
            }
            if (dec) {
                return String.fromCharCode(parseInt(dec, 10));
            }
            return AwsXmlParser.ENTITIES[named] ?? "";
        });
    }
}
