"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.play = play;
const ElevenLabsError_1 = require("../errors/ElevenLabsError");
const utils_1 = require("./utils");
function play(audio) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!(0, utils_1.isNode)()) {
            throw new ElevenLabsError_1.ElevenLabsError({
                message: "The play function is only available in a Node.js environment.",
            });
        }
        const { spawn } = yield Promise.resolve().then(() => __importStar(require("node:child_process")));
        const { Readable } = yield Promise.resolve().then(() => __importStar(require("node:stream")));
        const commandExists = (yield Promise.resolve().then(() => __importStar(require("command-exists")))).default;
        if (!commandExists.sync("ffplay")) {
            throw new ElevenLabsError_1.ElevenLabsError({
                message: `ffplay from ffmpeg not found, necessary to play audio.
            On mac you can install it with 'brew install ffmpeg'.
            On linux and windows you can install it from https://ffmpeg.org/`,
            });
        }
        const ffplay = spawn("ffplay", ["-autoexit", "-", "-nodisp"], {
            stdio: ["pipe", "ignore", "pipe"],
        });
        Readable.from(audio).pipe(ffplay.stdin);
        const errorChunks = [];
        ffplay.stderr.on("data", (chunk) => {
            errorChunks.push(chunk);
        });
        return new Promise((resolve, reject) => {
            ffplay.on("close", (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    const error = Buffer.concat(errorChunks).toString();
                    reject(new ElevenLabsError_1.ElevenLabsError({
                        message: `ffplay exited with code ${code}. Stderr: ${error}`,
                    }));
                }
            });
            ffplay.on("error", (err) => {
                reject(new ElevenLabsError_1.ElevenLabsError({ message: `Failed to start ffplay: ${err.message}` }));
            });
        });
    });
}
