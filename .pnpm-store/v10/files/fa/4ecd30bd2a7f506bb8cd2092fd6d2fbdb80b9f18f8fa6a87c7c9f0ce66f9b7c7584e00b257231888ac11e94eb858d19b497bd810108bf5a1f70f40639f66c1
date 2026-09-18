import { toUtf8 } from "@smithy/core/serde";
export class JsonBytesStringAdapter extends Uint8Array {
    string = null;
    static allocUnsafe(bytes) {
        if (typeof Buffer === "function") {
            const buffer = Buffer.allocUnsafe(bytes);
            return new JsonBytesStringAdapter(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        }
        return new JsonBytesStringAdapter(bytes);
    }
    toString() {
        return this.s();
    }
    valueOf() {
        return this.s();
    }
    includes(searchString, position) {
        if (typeof searchString === "string") {
            return this.s().includes(searchString, position);
        }
        return Uint8Array.prototype.includes.call(this, searchString, position);
    }
    indexOf(searchString, position) {
        if (typeof searchString === "string") {
            return this.s().indexOf(searchString, position);
        }
        return Uint8Array.prototype.indexOf.call(this, searchString, position);
    }
    lastIndexOf(searchString, position) {
        if (typeof searchString === "string") {
            return this.s().lastIndexOf(searchString, position);
        }
        const fn = Uint8Array.prototype.lastIndexOf;
        if (position !== undefined) {
            return fn.call(this, searchString, position);
        }
        return fn.call(this, searchString);
    }
    startsWith(searchString, position) {
        return this.s().startsWith(searchString, position);
    }
    endsWith(searchString, endPosition) {
        return this.s().endsWith(searchString, endPosition);
    }
    match(regexp) {
        return this.s().match(regexp);
    }
    replace(searchValue, replaceValue) {
        return this.s().replace(searchValue, replaceValue);
    }
    search(regexp) {
        return this.s().search(regexp);
    }
    split(separator, limit) {
        return this.s().split(separator, limit);
    }
    substring(start, end) {
        return this.s().substring(start, end);
    }
    trim() {
        return this.s().trim();
    }
    trimStart() {
        return this.s().trimStart();
    }
    trimEnd() {
        return this.s().trimEnd();
    }
    charAt(pos) {
        return this.s().charAt(pos);
    }
    charCodeAt(index) {
        return this.s().charCodeAt(index);
    }
    padStart(maxLength, fillString) {
        return this.s().padStart(maxLength, fillString);
    }
    padEnd(maxLength, fillString) {
        return this.s().padEnd(maxLength, fillString);
    }
    repeat(count) {
        return this.s().repeat(count);
    }
    toUpperCase() {
        return this.s().toUpperCase();
    }
    toLowerCase() {
        return this.s().toLowerCase();
    }
    s() {
        if (this.string == null) {
            const n = Date.now();
            if (n > warned + 60_000) {
                console.warn("@aws-sdk/core/protocols - WARN - JsonCodec2: you have called a string method on a Uint8Array request body. " +
                    "It has been automatically converted to string. In a future version this will throw an error.");
                warned = n;
            }
            this.string = toUtf8(this);
        }
        return this.string;
    }
}
var warned = 0;
