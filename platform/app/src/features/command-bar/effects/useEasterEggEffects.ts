import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";
import type { EasterEgg } from "../easterEggs";

export function useEasterEggEffects() {
  const triggerEffect = useCallback((egg: EasterEgg) => {
    switch (egg.effect) {
      case "confetti":
        triggerConfetti();
        break;
      case "barrelRoll":
        triggerBarrelRoll();
        break;
      case "toast":
        toaster.create({ title: egg.toastMessage ?? egg.label, type: "info" });
        break;
    }
  }, []);

  return { triggerEffect };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
}

function triggerConfetti() {
  // Create canvas overlay
  const canvas = document.createElement("canvas");
  canvas.id = "confetti-canvas";
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles: Particle[] = [];
  const colors = [
    "#f44336",
    "#e91e63",
    "#9c27b0",
    "#673ab7",
    "#3f51b5",
    "#2196f3",
    "#00bcd4",
    "#009688",
    "#4caf50",
    "#ffeb3b",
    "#ff9800",
  ];

  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      vx: (Math.random() - 0.5) * 10,
      vy: Math.random() * 3 + 2,
      color: colors[Math.floor(Math.random() * colors.length)] ?? "#f44336",
      size: Math.random() * 8 + 4,
    });
  }

  let frame = 0;
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    frame++;
    if (frame < 180) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  };
  animate();
}

function triggerBarrelRoll() {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog) {
    dialog.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 1000, easing: "ease-in-out" }
    );
  }
}
