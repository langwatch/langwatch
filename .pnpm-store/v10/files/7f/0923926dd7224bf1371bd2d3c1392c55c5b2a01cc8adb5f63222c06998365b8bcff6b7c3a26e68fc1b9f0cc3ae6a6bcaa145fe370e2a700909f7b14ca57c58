import { Readable } from "node:stream";
import { versions } from "node:process";

//#region src/utils/stream.ts
const pr54206Applied = () => {
	const [major, minor] = versions.node.split(".").map((component) => parseInt(component));
	return major >= 23 || major === 22 && minor >= 7 || major === 20 && minor >= 18;
};
const useReadableToWeb = pr54206Applied();
const createStreamBody = (stream, useNativeReadableToWeb = useReadableToWeb) => {
	if (useNativeReadableToWeb) return Readable.toWeb(stream);
	let controller;
	let settled = false;
	const cleanup = () => {
		stream.off("data", onData);
		stream.off("error", onError);
		stream.off("end", onTerminate);
		stream.off("close", onTerminate);
	};
	const settle = (callback) => {
		if (settled) return;
		settled = true;
		cleanup();
		callback?.();
	};
	const onData = (chunk) => {
		if (settled || !controller) return;
		controller.enqueue(chunk);
		if ((controller.desiredSize ?? 0) <= 0) stream.pause();
	};
	const onError = (error) => {
		settle(() => {
			controller?.error(error);
		});
	};
	const onTerminate = () => {
		settle(() => {
			controller?.close();
		});
	};
	return new ReadableStream({
		start(streamController) {
			controller = streamController;
			stream.on("data", onData);
			stream.on("error", onError);
			stream.on("end", onTerminate);
			stream.on("close", onTerminate);
			stream.pause();
		},
		pull() {
			if (!settled) stream.resume();
		},
		cancel() {
			settle();
			const ignoreError = () => {};
			stream.on("error", ignoreError);
			stream.once("close", () => stream.off("error", ignoreError));
			stream.destroy();
		}
	});
};

//#endregion
export { createStreamBody };