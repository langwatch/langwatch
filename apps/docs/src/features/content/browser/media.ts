function playbackFailed({ video }: { video: HTMLVideoElement }) {
  const figure = video.closest("figure");
  video.controls = false;
  video.dataset.failed = "true";
  const overlay = figure?.querySelector<HTMLButtonElement>("button")?.parentElement;
  if (overlay) overlay.hidden = false;
  if (figure?.querySelector('[role="alert"]')) return;
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.className = "docs-media-error";
  alert.textContent = "The video could not load. Try playing it again.";
  figure?.append(alert);
}

function onMediaError(event: Event) {
  const video = event.target instanceof Element ? event.target.closest("video") : null;
  if (video) playbackFailed({ video });
}

export function installMedia() {
  document.addEventListener("error", onMediaError, true);
  document.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!button?.textContent?.includes("Watch the product tour")) return;
    const figure = button.closest("figure");
    const video = figure?.querySelector("video");
    if (!video) return;
    if (video.error || video.dataset.failed) {
      video.load();
      delete video.dataset.failed;
    }
    figure?.querySelector('[role="alert"]')?.remove();
    video.controls = true;
    void video
      .play()
      .then(() => {
        if (button.parentElement) button.parentElement.hidden = true;
      })
      .catch(() => playbackFailed({ video }));
  });
}

const motion = matchMedia("(prefers-reduced-motion: no-preference)");
const pausedByReader = new WeakSet<HTMLVideoElement>();
const pausing = new WeakSet<HTMLVideoElement>();
let clipObserver: IntersectionObserver | null = null;

function pauseClip({ video }: { video: HTMLVideoElement }) {
  if (video.paused) return;
  pausing.add(video);
  video.pause();
}

/** GIF-replacement clips loop while visible when motion is allowed; a reader's pause sticks. */
function watchClips() {
  clipObserver?.disconnect();
  clipObserver = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!(target instanceof HTMLVideoElement)) continue;
      if (!isIntersecting || !motion.matches) pauseClip({ video: target });
      else if (!pausedByReader.has(target)) void target.play().catch(() => {});
    }
  });
  document.querySelectorAll<HTMLVideoElement>("video[data-docs-clip]").forEach((video) => {
    clipObserver?.observe(video);
    if (video.dataset.docsClipWatched) return;
    video.dataset.docsClipWatched = "";
    video.addEventListener("pause", () => {
      if (!pausing.delete(video)) pausedByReader.add(video);
    });
    video.addEventListener("play", () => pausedByReader.delete(video));
  });
}

installMedia();
watchClips();
document.addEventListener("docs:navigated", watchClips);
motion.addEventListener("change", watchClips);
