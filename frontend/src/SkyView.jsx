import { useEffect, useRef, useState } from "react";

/*
  SkyView.jsx
  Observer-centric sky view (azimuth / elevation)

  Includes:
  - Horizon + elevation rings
  - Cardinal directions
  - Real sky pass ARC (backend-driven where available)
  - Synthetic fallback arc
  - Live pass animation
  - Time scrubber / demo mode
  - Live multi-satellite sky dots (safe / optional)
*/

/* ======================================================
   FALLBACK SYNTHETIC ARC
====================================================== */
const API_BASE = "https://satellite-tracker-api.onrender.com";

function generateSyntheticArc(bestPass, radius, cx, cy) {
  const points = [];
  const azCenter = bestPass.azimuth_deg;
  const azStart = azCenter - 90;
  const azEnd = azCenter + 90;
  const steps = 160;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const elevation = Math.sin(t * Math.PI) * bestPass.max_elevation;
    const az = ((azStart + t * (azEnd - azStart)) * Math.PI) / 180;
    const r = radius * (1 - elevation / 90);

    points.push({
      x: cx + r * Math.sin(az),
      y: cy - r * Math.cos(az),
    });
  }

  return points;
}

export default function SkyView({ observerLocation, bestPass }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  /* =============================
     STATE
     ============================= */
  const [demoTime, setDemoTime] = useState(null);
  const [isLive, setIsLive] = useState(false);

  const [skyPath, setSkyPath] = useState([]);
  const [liveSats, setLiveSats] = useState([]);

  /* =============================
     INIT DEMO TIME
     ============================= */
  useEffect(() => {
    if (!bestPass?.rise || !bestPass?.set) return;

    const now = Date.now();
    const rise = new Date(bestPass.rise).getTime();
    const set = new Date(bestPass.set).getTime();

    if (now >= rise && now <= set) {
      setIsLive(true);
      setDemoTime(now);
    } else {
      setIsLive(false);
      setDemoTime(rise);
    }
  }, [bestPass]);

  /* =============================
     FETCH REAL PASS PATH (SAFE)
     ============================= */
  useEffect(() => {
    if (!bestPass || !observerLocation) return;

    fetch(
      `${API_BASE}/satellite/${bestPass.norad ?? ""}/pass-path?lat=${observerLocation.lat}&lon=${observerLocation.lon}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.path)) {
          setSkyPath(data.path);
        } else {
          setSkyPath([]);
        }
      })
      .catch(() => setSkyPath([]));
  }, [bestPass, observerLocation]);

  /* =============================
     LIVE SKY DOTS (OPTIONAL / SAFE)
     ============================= */
  useEffect(() => {
    if (!observerLocation) return;

    // Immediately fetch when opened
    const fetchLiveSats = () => {
      fetch(
        `${API_BASE}/observer/sky?lat=${observerLocation.lat}&lon=${observerLocation.lon}`
      )
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.satellites)) {
            setLiveSats(data.satellites);
          } else {
            setLiveSats([]);
          }
        })
        .catch(() => setLiveSats([]));
    };
    
    fetchLiveSats();
    const interval = setInterval(fetchLiveSats, 3000);

    return () => clearInterval(interval);
  }, [observerLocation]);

  /* =============================
     CANVAS DRAW LOOP
     ============================= */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    function resize() {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    window.addEventListener("resize", resize);
    resize();

    function drawFrame() {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.42;

      ctx.clearRect(0, 0, w, h);

      /* Background */
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, w, h);

      /* Radial gradient for horizon shading */
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 1.5);
      grad.addColorStop(0, "rgba(5, 6, 10, 0.0)");
      grad.addColorStop(1, "rgba(4, 8, 20, 0.9)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      /* Horizon */
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      /* Rings */
      drawRing(radius * 0.66, "60°");
      drawRing(radius * 0.33, "30°");

      /* Cardinals */
      drawLabel("N", cx, cy - radius - 14);
      drawLabel("S", cx, cy + radius + 24);
      drawLabel("E", cx + radius + 22, cy + 4);
      drawLabel("W", cx - radius - 22, cy + 4);

      /* LIVE SKY DOTS (if any) */
      liveSats.forEach((sat) => {
        if (sat.el <= 0) return;
        const az = (sat.az * Math.PI) / 180;
        const r = radius * (1 - sat.el / 90);
        const x = cx + r * Math.sin(az);
        const y = cy - r * Math.cos(az);

        if (bestPass && sat.norad === bestPass.norad) {
          ctx.fillStyle = "#ffd700";
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "rgba(0,180,255,0.85)";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      /* PASS ARC + SATELLITE */
      if (bestPass && demoTime != null) {
        const rise = new Date(bestPass.rise).getTime();
        const set = new Date(bestPass.set).getTime();

        const arc =
          skyPath.length > 1
            ? skyPath
              .filter((p) => p.el > 0)
              .map((p) => {
                const az = (p.az * Math.PI) / 180;
                const r = radius * (1 - p.el / 90);
                return {
                  x: cx + r * Math.sin(az),
                  y: cy - r * Math.cos(az),
                };
              })
            : generateSyntheticArc(bestPass, radius, cx, cy);

        ctx.strokeStyle = "rgba(255,215,0,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        arc.forEach((p, i) =>
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
        );
        ctx.stroke();

        const t = Math.max(0, Math.min(1, (demoTime - rise) / (set - rise)));
        const exactIdx = t * (arc.length - 1);
        const idx1 = Math.floor(exactIdx);
        const idx2 = Math.min(idx1 + 1, arc.length - 1);
        const frac = exactIdx - idx1;

        const p1 = arc[idx1];
        const p2 = arc[idx2];
        const p = p1 && p2 ? {
          x: p1.x + (p2.x - p1.x) * frac,
          y: p1.y + (p2.y - p1.y) * frac
        } : p1;

        if (p) {
          ctx.fillStyle = "#ffd700";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = "rgba(255,215,0,0.6)";
          ctx.lineWidth = 3;
          ctx.stroke();

          drawLabel("🛰", p.x, p.y - 12);
        }

        if (isLive) {
          setDemoTime(Date.now());
        }
      }

      rafRef.current = requestAnimationFrame(drawFrame);
    }

    function drawRing(r, label) {
      const ctx = canvasRef.current?.getContext("2d");
      if(!ctx) return;
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px system-ui";
      ctx.fillText(label, canvas.width / 2 + 6, canvas.height / 2 - r + 14);
    }

    function drawLabel(text, x, y) {
      const ctx = canvasRef.current?.getContext("2d");
      if(!ctx) return;
      ctx.fillStyle = "white";
      ctx.font = "bold 14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(text, x, y);
      ctx.textAlign = "start";
    }

    drawFrame();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [bestPass, observerLocation, demoTime, isLive, skyPath, liveSats]);

  /* =============================
     RENDER
     ============================= */
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#05060a",
        zIndex: 5, // IMPORTANT: allow pass panel + headers above
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      />

      {/* Visible Count Overlay */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "rgba(0,0,0,0.6)",
          padding: "8px 12px",
          borderRadius: "8px",
          color: "white",
          fontFamily: "system-ui",
          fontSize: 14,
          zIndex: 6,
          border: "1px solid rgba(255,255,255,0.15)",
        }}
      >
        <span style={{ color: "#00b4ff", marginRight: 6 }}>●</span> 
        Visible Satellites: <strong>{liveSats.filter(s => s.el > 0).length}</strong>
      </div>

      {/* Time Scrubber */}
      {bestPass && demoTime != null && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            width: "80%",
            background: "rgba(0,0,0,0.6)",
            padding: "10px",
            borderRadius: "10px",
            zIndex: 6,
          }}
        >
          <input
            type="range"
            min={new Date(bestPass.rise).getTime()}
            max={new Date(bestPass.set).getTime()}
            value={demoTime}
            step={1000}
            disabled={isLive}
            onChange={(e) => setDemoTime(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ textAlign: "center", fontSize: 12, opacity: 0.8 }}>
            {isLive ? "🔴 Live pass" : "⏱ Scrub to preview the pass"}
          </div>
        </div>
      )}
    </div>
  );
}
