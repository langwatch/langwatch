const ATTR_ESCAPE_RE = /[&<>"]/g;
const ATTR_ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
};
function escapeAttribute(value) {
    return value.replace(ATTR_ESCAPE_RE, (ch) => ATTR_ESCAPE_MAP[ch]);
}

const ELEMENT_ESCAPE_RE = /[&"'<>\r\n\u0085\u2028]/g;
const ELEMENT_ESCAPE_MAP = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
    "<": "&lt;",
    ">": "&gt;",
    "\r": "&#x0D;",
    "\n": "&#x0A;",
    "\u0085": "&#x85;",
    "\u2028": "&#x2028;",
};
function escapeElement(value) {
    return value.replace(ELEMENT_ESCAPE_RE, (ch) => ELEMENT_ESCAPE_MAP[ch]);
}

class XmlText {
    value;
    constructor(value) {
        this.value = value;
    }
    toString() {
        return escapeElement("" + this.value);
    }
}

class XmlNode {
    name;
    children;
    attributes = {};
    static of(name, childText, withName) {
        const node = new XmlNode(name);
        if (childText !== undefined) {
            node.addChildNode(new XmlText(childText));
        }
        if (withName !== undefined) {
            node.withName(withName);
        }
        return node;
    }
    constructor(name, children = []) {
        this.name = name;
        this.children = children;
    }
    withName(name) {
        this.name = name;
        return this;
    }
    addAttribute(name, value) {
        this.attributes[name] = value;
        return this;
    }
    addChildNode(child) {
        this.children.push(child);
        return this;
    }
    removeAttribute(name) {
        delete this.attributes[name];
        return this;
    }
    n(name) {
        this.name = name;
        return this;
    }
    c(child) {
        this.children.push(child);
        return this;
    }
    a(name, value) {
        if (value != null) {
            this.attributes[name] = value;
        }
        return this;
    }
    cc(input, field, withName = field) {
        if (input[field] != null) {
            const node = XmlNode.of(field, input[field]).withName(withName);
            this.c(node);
        }
    }
    l(input, listName, memberName, valueProvider) {
        if (input[listName] != null) {
            const nodes = valueProvider();
            nodes.map((node) => {
                node.withName(memberName);
                this.c(node);
            });
        }
    }
    lc(input, listName, memberName, valueProvider) {
        if (input[listName] != null) {
            const nodes = valueProvider();
            const containerNode = new XmlNode(memberName);
            nodes.map((node) => {
                containerNode.c(node);
            });
            this.c(containerNode);
        }
    }
    toString() {
        const hasChildren = Boolean(this.children.length);
        let xmlText = `<${this.name}`;
        const attributes = this.attributes;
        for (const attributeName of Object.keys(attributes)) {
            const attribute = attributes[attributeName];
            if (attribute != null) {
                xmlText += ` ${attributeName}="${escapeAttribute("" + attribute)}"`;
            }
        }
        return (xmlText += !hasChildren ? "/>" : `>${this.children.map((c) => c.toString()).join("")}</${this.name}>`);
    }
}

function writeKey(obj) {
    Object.defineProperty(obj, "__proto__", { value: undefined, writable: true, enumerable: true, configurable: true });
}
function parseXML(xml) {
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

exports.XmlNode = XmlNode;
exports.XmlText = XmlText;
exports.parseXML = parseXML;
